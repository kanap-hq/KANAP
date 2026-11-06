import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, EntityManager } from 'typeorm';
import { PortfolioCriterion } from './portfolio-criterion.entity';
import { PortfolioCriterionValue } from './portfolio-criterion-value.entity';
import { PortfolioRequest } from './portfolio-request.entity';
import { PortfolioProject } from './portfolio-project.entity';
import { PortfolioSettings } from './portfolio-settings.entity';
import { PortfolioActivity } from './portfolio-activity.entity';
import { AuditService } from '../audit/audit.service';
import {
  CriteriaLabelMaps,
  CriteriaValuesMap,
  formatCriteriaDiff,
  listChangedCriteria,
} from './utils/activity-labels';
import { detectChanges, FieldConfig } from '../common/change-detection';
import { tenantSeedLanguage } from '../analytics/recommended-dimensions.seed';
import { defaultCriteriaIn } from './default-criteria.seed';

// `numeric` columns come back from Postgres as strings, so the score and the
// override value are compared (and recorded) as numbers: a plain `!==` would
// log "75.00 → 75" on every save.
const SCORE_FIELDS: FieldConfig[] = [
  { field: 'priority_score', compare: 'number' },
];

const OVERRIDE_FIELDS: FieldConfig[] = [
  { field: 'priority_override' },
  { field: 'override_value', compare: 'number' },
  { field: 'override_justification' },
  { field: 'priority_score', compare: 'number' },
];

@Injectable()
export class PortfolioCriteriaService {
  constructor(
    @InjectRepository(PortfolioCriterion)
    private readonly repo: Repository<PortfolioCriterion>,
    @InjectRepository(PortfolioCriterionValue)
    private readonly valueRepo: Repository<PortfolioCriterionValue>,
    @InjectRepository(PortfolioRequest)
    private readonly requestRepo: Repository<PortfolioRequest>,
    @InjectRepository(PortfolioSettings)
    private readonly settingsRepo: Repository<PortfolioSettings>,
    private readonly audit: AuditService,
  ) {}

  // ==================== LIST ====================
  async list(tenantId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const criteriaRepo = mg.getRepository(PortfolioCriterion);
    const valuesRepo = mg.getRepository(PortfolioCriterionValue);

    let criteria = await criteriaRepo.find({
      where: { tenant_id: tenantId },
      order: { display_order: 'ASC', name: 'ASC' },
    });

    // Seed default criteria if none exist for this tenant
    if (criteria.length === 0) {
      await this.seedDefaultCriteria(tenantId, mg);
      criteria = await criteriaRepo.find({
        where: { tenant_id: tenantId },
        order: { display_order: 'ASC', name: 'ASC' },
      });
    }

    if (criteria.length === 0) return [];

    // Load values for all criteria
    const criteriaIds = criteria.map((c) => c.id);
    const values = await valuesRepo.find({
      where: { criterion_id: In(criteriaIds) },
      order: { position: 'ASC' },
    });

    // Group values by criterion
    const valuesByCriterion: Record<string, PortfolioCriterionValue[]> = {};
    values.forEach((v) => {
      if (!valuesByCriterion[v.criterion_id]) {
        valuesByCriterion[v.criterion_id] = [];
      }
      valuesByCriterion[v.criterion_id].push(v);
    });

    // Attach values to criteria
    return criteria.map((c) => ({
      ...c,
      values: valuesByCriterion[c.id] || [],
    }));
  }

  // ==================== GET ====================
  async get(id: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const criteriaRepo = mg.getRepository(PortfolioCriterion);
    const valuesRepo = mg.getRepository(PortfolioCriterionValue);

    const criterion = await criteriaRepo.findOne({ where: { id } });
    if (!criterion) throw new NotFoundException('Criterion not found');

    const values = await valuesRepo.find({
      where: { criterion_id: id },
      order: { position: 'ASC' },
    });

    return { ...criterion, values };
  }

  // ==================== CREATE ====================
  async create(
    body: {
      name: string;
      inverted?: boolean;
      weight?: number;
      enabled?: boolean;
      values: Array<{ label: string; triggers_mandatory_bypass?: boolean }>;
    },
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const criteriaRepo = mg.getRepository(PortfolioCriterion);
    const valuesRepo = mg.getRepository(PortfolioCriterionValue);

    // Validate name
    const name = String(body.name || '').trim();
    if (!name) throw new BadRequestException('name is required');

    // Check uniqueness
    const existing = await criteriaRepo.findOne({
      where: { tenant_id: tenantId, name },
    });
    if (existing) throw new BadRequestException('Criterion name must be unique');

    // Validate values (minimum 2)
    const values = body.values || [];
    if (values.length < 2) {
      throw new BadRequestException('Criterion must have at least 2 scale values');
    }

    // Validate weight
    const weight = body.weight ?? 1;
    if (weight <= 0) throw new BadRequestException('Weight must be positive');

    // Get max display_order
    const maxOrder = await criteriaRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .select('MAX(c.display_order)', 'max')
      .getRawOne();
    const displayOrder = (maxOrder?.max ?? -1) + 1;

    // Check for mandatory bypass flag conflicts
    if (values.some((v) => v.triggers_mandatory_bypass)) {
      await this.clearMandatoryBypassFlag(tenantId, mg);
    }

    // Create criterion
    const criterion = criteriaRepo.create({
      tenant_id: tenantId,
      name,
      enabled: body.enabled !== false,
      inverted: body.inverted === true,
      weight,
      display_order: displayOrder,
    });

    const savedCriterion = await criteriaRepo.save(criterion);

    // Create values
    const savedValues: PortfolioCriterionValue[] = [];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const value = valuesRepo.create({
        tenant_id: savedCriterion.tenant_id,
        criterion_id: savedCriterion.id,
        label: String(v.label || '').trim(),
        position: i,
        triggers_mandatory_bypass: v.triggers_mandatory_bypass === true,
      });
      savedValues.push(await valuesRepo.save(value));
    }

    await this.audit.log({
      table: 'portfolio_criteria',
      recordId: savedCriterion.id,
      action: 'create',
      before: null,
      after: { ...savedCriterion, values: savedValues },
      userId,
    }, { manager: mg });

    return { ...savedCriterion, values: savedValues };
  }

  /**
   * Clear mandatory bypass flag from all other values (only one can have it)
   */
  private async clearMandatoryBypassFlag(
    tenantId: string,
    mg: EntityManager,
    excludeCriterionId?: string,
  ) {
    let query = `
      UPDATE portfolio_criterion_values v
      SET triggers_mandatory_bypass = false
      FROM portfolio_criteria c
      WHERE v.criterion_id = c.id
      AND c.tenant_id = $1
      AND v.triggers_mandatory_bypass = true
    `;
    const params: any[] = [tenantId];

    if (excludeCriterionId) {
      query += ` AND c.id != $2`;
      params.push(excludeCriterionId);
    }

    await mg.query(query, params);
  }

  // ==================== UPDATE ====================
  async update(
    id: string,
    body: {
      name?: string;
      inverted?: boolean;
      weight?: number;
      enabled?: boolean;
      values?: Array<{
        id?: string;
        label: string;
        triggers_mandatory_bypass?: boolean;
      }>;
    },
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const criteriaRepo = mg.getRepository(PortfolioCriterion);
    const valuesRepo = mg.getRepository(PortfolioCriterionValue);

    const criterion = await criteriaRepo.findOne({ where: { id } });
    if (!criterion) throw new NotFoundException('Criterion not found');

    const before = await this.get(id, { manager: mg });
    const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

    // Update criterion fields
    if (has('name')) {
      const name = String(body.name || '').trim();
      if (!name) throw new BadRequestException('name cannot be empty');

      // Check uniqueness (excluding self)
      const existing = await criteriaRepo.findOne({
        where: { tenant_id: tenantId, name },
      });
      if (existing && existing.id !== id) {
        throw new BadRequestException('Criterion name must be unique');
      }
      criterion.name = name;
    }

    if (has('inverted')) criterion.inverted = body.inverted === true;
    if (has('enabled')) criterion.enabled = body.enabled !== false;
    if (has('weight')) {
      const weight = Number(body.weight);
      if (isNaN(weight) || weight <= 0) {
        throw new BadRequestException('Weight must be positive');
      }
      criterion.weight = weight;
    }

    criterion.updated_at = new Date();
    await criteriaRepo.save(criterion);

    // Update values if provided
    if (has('values')) {
      const newValues = body.values || [];
      if (newValues.length < 2) {
        throw new BadRequestException('Criterion must have at least 2 scale values');
      }

      // Check for mandatory bypass flag
      const hasBypassFlag = newValues.some((v) => v.triggers_mandatory_bypass);
      if (hasBypassFlag) {
        // Clear from other criteria
        await this.clearMandatoryBypassFlag(tenantId, mg, id);
        // Clear from this criterion's values (will be re-set below)
        await valuesRepo.update(
          { criterion_id: id },
          { triggers_mandatory_bypass: false },
        );
      }

      // Get existing values
      const existingValues = await valuesRepo.find({ where: { criterion_id: id } });
      const existingMap = new Map(existingValues.map((v) => [v.id, v]));

      // Track which values to keep
      const toKeep = new Set<string>();

      for (let i = 0; i < newValues.length; i++) {
        const v = newValues[i];
        if (v.id && existingMap.has(v.id)) {
          // Update existing
          const existing = existingMap.get(v.id)!;
          existing.label = String(v.label || '').trim();
          existing.position = i;
          existing.triggers_mandatory_bypass = v.triggers_mandatory_bypass === true;
          await valuesRepo.save(existing);
          toKeep.add(v.id);
        } else {
          // Create new
          const newValue = valuesRepo.create({
            tenant_id: criterion.tenant_id,
            criterion_id: id,
            label: String(v.label || '').trim(),
            position: i,
            triggers_mandatory_bypass: v.triggers_mandatory_bypass === true,
          });
          await valuesRepo.save(newValue);
        }
      }

      // Handle deleted values - reassign requests per spec 4.5.2
      const toDelete = existingValues.filter((v) => !toKeep.has(v.id));
      for (const deletedValue of toDelete) {
        await this.reassignRequestsOnValueDelete(
          id,
          deletedValue.id,
          deletedValue.position,
          criterion.inverted,
          newValues.length,
          mg,
        );
        await valuesRepo.delete({ id: deletedValue.id });
      }
    }

    // Recalculate scores for affected requests
    await this.recalculateScoresForCriterion(id, tenantId, mg);

    const after = await this.get(id, { manager: mg });

    await this.audit.log({
      table: 'portfolio_criteria',
      recordId: id,
      action: 'update',
      before,
      after,
      userId,
    }, { manager: mg });

    return after;
  }

  // ==================== REORDER ====================
  /**
   * Reorder criteria for a tenant by reassigning `display_order` from the
   * given id list. Criteria not present in the payload keep their relative
   * order, appended after the listed ones, so the tenant order stays dense.
   */
  async reorder(
    ids: string[],
    tenantId: string,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const criteriaRepo = mg.getRepository(PortfolioCriterion);

    const existing = await criteriaRepo.find({
      where: { tenant_id: tenantId },
      order: { display_order: 'ASC', name: 'ASC' },
    });
    const existingById = new Map(existing.map((c) => [c.id, c]));

    const ordered: PortfolioCriterion[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const c = existingById.get(id);
      if (c && !seen.has(id)) {
        ordered.push(c);
        seen.add(id);
      }
    }
    for (const c of existing) {
      if (!seen.has(c.id)) {
        ordered.push(c);
        seen.add(c.id);
      }
    }

    for (let i = 0; i < ordered.length; i++) {
      const c = ordered[i];
      if (c.display_order === i) continue;
      await criteriaRepo.update(
        { id: c.id, tenant_id: tenantId },
        { display_order: i, updated_at: new Date() },
      );
    }

    return { ok: true };
  }

  /**
   * When a scale value is deleted, reassign requests to adjacent lower-score position
   * per spec section 4.5.2
   */
  private async reassignRequestsOnValueDelete(
    criterionId: string,
    deletedValueId: string,
    deletedPosition: number,
    inverted: boolean,
    newScaleLength: number,
    mg: EntityManager,
  ) {
    // Find requests that had this value selected
    const requests = await mg.query(
      `SELECT id, criteria_values FROM portfolio_requests
       WHERE criteria_values ? $1
       AND criteria_values->>$1 = $2`,
      [criterionId, deletedValueId]
    );

    if (requests.length === 0) return;

    // Determine new position (adjacent that yields lower score)
    let newPosition: number;
    if (inverted) {
      // For inverted: higher position = lower score, so move to next position
      newPosition = Math.min(deletedPosition + 1, newScaleLength - 1);
    } else {
      // For non-inverted: lower position = lower score, so move to previous position
      newPosition = Math.max(deletedPosition - 1, 0);
    }

    // Get the value at new position
    const newValue = await mg.query(
      `SELECT id FROM portfolio_criterion_values
       WHERE criterion_id = $1 AND position = $2`,
      [criterionId, newPosition]
    );

    if (newValue.length === 0) return;

    const newValueId = newValue[0].id;

    // Update requests
    for (const req of requests) {
      const criteriaValues = req.criteria_values || {};
      criteriaValues[criterionId] = newValueId;
      await mg.query(
        `UPDATE portfolio_requests SET criteria_values = $1 WHERE id = $2`,
        [JSON.stringify(criteriaValues), req.id]
      );
    }
  }

  // ==================== DELETE ====================
  async delete(
    id: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const criteriaRepo = mg.getRepository(PortfolioCriterion);
    const valuesRepo = mg.getRepository(PortfolioCriterionValue);

    const criterion = await criteriaRepo.findOne({ where: { id } });
    if (!criterion) throw new NotFoundException('Criterion not found');

    const before = await this.get(id, { manager: mg });
    const tenantId = criterion.tenant_id;

    // Remove criterion values from all requests
    await mg.query(
      `UPDATE portfolio_requests
       SET criteria_values = criteria_values - $1
       WHERE criteria_values ? $1`,
      [id]
    );

    // Delete values (cascade handles this, but be explicit)
    await valuesRepo.delete({ criterion_id: id });

    // Delete criterion
    await criteriaRepo.delete({ id });

    // Recalculate scores for all requests (since weights changed)
    await this.recalculateAllScores(tenantId, mg);

    await this.audit.log({
      table: 'portfolio_criteria',
      recordId: id,
      action: 'delete',
      before,
      after: null,
      userId,
    }, { manager: mg });

    return { ok: true };
  }

  // ==================== SCORING ENGINE ====================

  /**
   * Calculate priority score for a request per spec section 4.5.1
   */
  async calculateScore(
    requestId: string,
    tenantId: string,
    opts?: { manager?: EntityManager; criteriaValues?: Record<string, string> },
  ): Promise<number> {
    const mg = opts?.manager ?? this.repo.manager;

    // Get criteria values - use provided values or load from request
    let criteriaValues: Record<string, string>;
    if (opts?.criteriaValues) {
      criteriaValues = opts.criteriaValues;
    } else {
      const request = await mg.getRepository(PortfolioRequest).findOne({
        where: { id: requestId },
      });
      if (!request) throw new NotFoundException('Request not found');
      criteriaValues = request.criteria_values || {};
    }

    // Get all enabled criteria for tenant
    const criteria = await mg.query(
      `SELECT c.*,
        (SELECT json_agg(v ORDER BY v.position)
         FROM portfolio_criterion_values v
         WHERE v.criterion_id = c.id) as values
       FROM portfolio_criteria c
       WHERE c.tenant_id = $1 AND c.enabled = true
       ORDER BY c.display_order`,
      [tenantId]
    );

    if (criteria.length === 0) {
      return 0; // No criteria = score 0
    }

    // Get settings for mandatory bypass
    const settings = await this.getSettings(tenantId, mg);

    // Check for mandatory bypass first
    if (settings.mandatory_bypass_enabled) {
      for (const criterion of criteria) {
        const selectedValueId = criteriaValues[criterion.id];
        if (!selectedValueId) continue;

        const values = criterion.values || [];
        const selectedValue = values.find((v: any) => v.id === selectedValueId);
        if (selectedValue?.triggers_mandatory_bypass) {
          // Mandatory bypass active - return 100
          return 100;
        }
      }
    }

    // Calculate weighted average
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const criterion of criteria) {
      const weight = Number(criterion.weight) || 1;
      const values = criterion.values || [];

      if (values.length < 2) continue; // Skip invalid criteria

      const selectedValueId = criteriaValues[criterion.id];
      if (!selectedValueId) {
        // No value selected - defaults to first position (0% for non-inverted)
        const percentage = criterion.inverted ? 100 : 0;
        totalWeightedScore += percentage * weight;
        totalWeight += weight;
        continue;
      }

      const selectedValue = values.find((v: any) => v.id === selectedValueId);
      if (!selectedValue) continue;

      const position = selectedValue.position;
      const maxPosition = values.length - 1;

      // Calculate percentage per spec
      let percentage: number;
      if (criterion.inverted) {
        percentage = ((maxPosition - position) / maxPosition) * 100;
      } else {
        percentage = (position / maxPosition) * 100;
      }

      totalWeightedScore += percentage * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) {
      return 0;
    }

    return Math.round((totalWeightedScore / totalWeight) * 100) / 100;
  }

  /**
   * Update a request's criteria values and recalculate score
   */
  async updateRequestCriteria(
    requestId: string,
    criteriaValues: Record<string, string>, // { criterionId: valueId }
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const requestRepo = mg.getRepository(PortfolioRequest);

    const request = await requestRepo.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');

    if (request.status === 'converted') {
      throw new BadRequestException('Cannot update scoring on converted requests');
    }

    const before = { ...request };

    // Validate all criterion/value pairs
    await this.validateCriteriaValues(criteriaValues, tenantId, mg);

    // Update criteria values
    request.criteria_values = criteriaValues;

    // Calculate new score using the NEW criteria values (not stale DB values)
    const newScore = await this.calculateScore(requestId, tenantId, {
      manager: mg,
      criteriaValues,
    });

    // Check if mandatory bypass blocks override
    const settings = await this.getSettings(tenantId, mg);
    const bypassActive = await this.isMandatoryBypassActive(
      criteriaValues,
      tenantId,
      settings,
      mg
    );

    if (bypassActive) {
      // Mandatory bypass - set score to 100 and disable override
      request.priority_score = 100;
      request.priority_override = false;
      request.override_value = null;
      request.override_justification = null;
    } else if (request.priority_override && request.override_value != null) {
      // Manual override active
      request.priority_score = request.override_value;
    } else {
      // Use calculated score
      request.priority_score = newScore;
    }

    request.updated_at = new Date();
    const saved = await requestRepo.save(request);

    // Log scoring change as activity
    await this.logScoringChange(mg, {
      target: { request_id: requestId },
      tenantId,
      userId,
      before,
      after: saved,
    });

    await this.audit.log({
      table: 'portfolio_requests',
      recordId: requestId,
      action: 'update',
      before,
      after: saved,
      userId,
    }, { manager: mg });

    return saved;
  }

  /**
   * Log a scoring change on a request or a project.
   *
   * The score is only recorded when it really moved, and the criteria are
   * stored as readable before/after labels of the criteria that changed —
   * never as the raw criterion/value identifier maps, which no one can read.
   */
  private async logScoringChange(
    mg: EntityManager,
    params: {
      target: { request_id: string } | { project_id: string };
      tenantId: string;
      userId: string | null;
      before: { priority_score?: unknown; criteria_values?: unknown };
      after: { priority_score?: unknown; criteria_values?: unknown };
    },
  ): Promise<void> {
    const changedFields: Record<string, [unknown, unknown]> = {};
    for (const change of detectChanges(
      params.before as unknown as Record<string, unknown>,
      params.after as unknown as Record<string, unknown>,
      SCORE_FIELDS,
    )) {
      changedFields[change.field] = [change.before, change.after];
    }

    const beforeValues = (params.before.criteria_values ?? {}) as CriteriaValuesMap;
    const afterValues = (params.after.criteria_values ?? {}) as CriteriaValuesMap;
    if (listChangedCriteria(beforeValues, afterValues).length > 0) {
      const labels = await this.loadCriteriaLabels(params.tenantId, mg);
      const diff = formatCriteriaDiff(beforeValues, afterValues, labels);
      if (diff) changedFields.criteria_values = diff;
    }

    if (Object.keys(changedFields).length === 0) return;

    await mg.getRepository(PortfolioActivity).save({
      ...params.target,
      tenant_id: params.tenantId,
      author_id: params.userId,
      type: 'change',
      changed_fields: changedFields,
    });
  }

  /** Criterion names and option labels of the tenant, for scoring diffs. */
  private async loadCriteriaLabels(tenantId: string, mg: EntityManager): Promise<CriteriaLabelMaps> {
    const rows = await mg.query<Array<{
      criterion_id: string;
      criterion_name: string;
      value_id: string | null;
      value_label: string | null;
    }>>(
      `SELECT c.id AS criterion_id, c.name AS criterion_name, v.id AS value_id, v.label AS value_label
       FROM portfolio_criteria c
       LEFT JOIN portfolio_criterion_values v ON v.criterion_id = c.id
       WHERE c.tenant_id = $1`,
      [tenantId],
    );

    const criterionName = new Map<string, string>();
    const optionLabel = new Map<string, string>();
    for (const row of rows) {
      criterionName.set(row.criterion_id, row.criterion_name);
      if (row.value_id) optionLabel.set(row.value_id, row.value_label ?? '');
    }
    return { criterionName, optionLabel };
  }

  /**
   * Validate that all criterion/value pairs are valid
   */
  private async validateCriteriaValues(
    criteriaValues: Record<string, string>,
    tenantId: string,
    mg: EntityManager,
  ) {
    for (const [criterionId, valueId] of Object.entries(criteriaValues)) {
      if (!valueId) continue;

      // Verify criterion exists and belongs to tenant
      const criterion = await mg.query(
        `SELECT id FROM portfolio_criteria WHERE id = $1 AND tenant_id = $2`,
        [criterionId, tenantId]
      );
      if (criterion.length === 0) {
        throw new BadRequestException(`Invalid criterion: ${criterionId}`);
      }

      // Verify value exists and belongs to criterion
      const value = await mg.query(
        `SELECT id FROM portfolio_criterion_values WHERE id = $1 AND criterion_id = $2`,
        [valueId, criterionId]
      );
      if (value.length === 0) {
        throw new BadRequestException(`Invalid value ${valueId} for criterion ${criterionId}`);
      }
    }
  }

  /**
   * Set or clear manual priority override
   */
  async setOverride(
    requestId: string,
    enabled: boolean,
    value: number | null,
    justification: string | null,
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const requestRepo = mg.getRepository(PortfolioRequest);
    if (!userId) throw new BadRequestException('userId is required for change activity logging');

    const request = await requestRepo.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');

    if (request.status === 'converted') {
      throw new BadRequestException('Cannot update scoring on converted requests');
    }

    // Check if mandatory bypass is active
    const settings = await this.getSettings(tenantId, mg);
    const bypassActive = await this.isMandatoryBypassActive(
      request.criteria_values || {},
      tenantId,
      settings,
      mg
    );

    if (bypassActive && enabled) {
      throw new BadRequestException(
        'Cannot enable manual override when mandatory bypass is active'
      );
    }

    const before = { ...request };

    if (enabled) {
      if (value == null || value < 0 || value > 100) {
        throw new BadRequestException('Override value must be between 0 and 100');
      }
      if (!justification || !String(justification).trim()) {
        throw new BadRequestException('Override justification is required');
      }

      request.priority_override = true;
      request.override_value = value;
      request.override_justification = String(justification).trim();
      request.priority_score = value;
    } else {
      request.priority_override = false;
      request.override_value = null;
      request.override_justification = null;
      // Recalculate score
      request.priority_score = await this.calculateScore(requestId, tenantId, { manager: mg });
    }

    request.updated_at = new Date();
    const saved = await requestRepo.save(request);

    const changedFields: Record<string, [unknown, unknown]> = {};
    for (const change of detectChanges(
      before as unknown as Record<string, unknown>,
      saved as unknown as Record<string, unknown>,
      OVERRIDE_FIELDS,
    )) {
      changedFields[change.field] = [change.before, change.after];
    }
    if (Object.keys(changedFields).length > 0) {
      await mg.getRepository(PortfolioActivity).save({
        request_id: requestId,
        tenant_id: tenantId,
        author_id: userId,
        type: 'change',
        changed_fields: changedFields,
      });
    }

    await this.audit.log({
      table: 'portfolio_requests',
      recordId: requestId,
      action: 'update',
      before,
      after: saved,
      userId,
    }, { manager: mg });

    return saved;
  }

  // ==================== PROJECT SCORING ====================

  /**
   * Calculate score from criteria values (generic - works for any entity)
   */
  async calculateScoreFromCriteria(
    criteriaValues: Record<string, string>,
    tenantId: string,
    opts?: { manager?: EntityManager },
  ): Promise<number> {
    const mg = opts?.manager ?? this.repo.manager;

    // Get all enabled criteria for tenant
    const criteria = await mg.query(
      `SELECT c.*,
        (SELECT json_agg(v ORDER BY v.position)
         FROM portfolio_criterion_values v
         WHERE v.criterion_id = c.id) as values
       FROM portfolio_criteria c
       WHERE c.tenant_id = $1 AND c.enabled = true
       ORDER BY c.display_order`,
      [tenantId]
    );

    if (criteria.length === 0) {
      return 0;
    }

    // Get settings for mandatory bypass
    const settings = await this.getSettings(tenantId, mg);

    // Check for mandatory bypass first
    if (settings.mandatory_bypass_enabled) {
      for (const criterion of criteria) {
        const selectedValueId = criteriaValues[criterion.id];
        if (!selectedValueId) continue;

        const values = criterion.values || [];
        const selectedValue = values.find((v: any) => v.id === selectedValueId);
        if (selectedValue?.triggers_mandatory_bypass) {
          return 100;
        }
      }
    }

    // Calculate weighted average
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const criterion of criteria) {
      const weight = Number(criterion.weight) || 1;
      const values = criterion.values || [];

      if (values.length < 2) continue;

      const selectedValueId = criteriaValues[criterion.id];
      if (!selectedValueId) {
        const percentage = criterion.inverted ? 100 : 0;
        totalWeightedScore += percentage * weight;
        totalWeight += weight;
        continue;
      }

      const selectedValue = values.find((v: any) => v.id === selectedValueId);
      if (!selectedValue) continue;

      const position = selectedValue.position;
      const maxPosition = values.length - 1;

      let percentage: number;
      if (criterion.inverted) {
        percentage = ((maxPosition - position) / maxPosition) * 100;
      } else {
        percentage = (position / maxPosition) * 100;
      }

      totalWeightedScore += percentage * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) {
      return 0;
    }

    return Math.round((totalWeightedScore / totalWeight) * 100) / 100;
  }

  /**
   * Update a project's criteria values and recalculate score
   */
  async updateProjectCriteria(
    projectId: string,
    criteriaValues: Record<string, string>,
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const projectRepo = mg.getRepository(PortfolioProject);

    const project = await projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    // Cannot update scoring on terminal projects
    if (project.status === 'done' || project.status === 'cancelled') {
      throw new BadRequestException('Cannot update scoring on completed or cancelled projects');
    }

    const before = { ...project };

    // Validate all criterion/value pairs
    await this.validateCriteriaValues(criteriaValues, tenantId, mg);

    // Update criteria values
    project.criteria_values = criteriaValues;

    // Calculate new score
    const newScore = await this.calculateScoreFromCriteria(criteriaValues, tenantId, { manager: mg });

    // Check if mandatory bypass blocks override
    const settings = await this.getSettings(tenantId, mg);
    const bypassActive = await this.isMandatoryBypassActive(
      criteriaValues,
      tenantId,
      settings,
      mg
    );

    if (bypassActive) {
      project.priority_score = 100;
      project.priority_override = false;
      project.override_value = null;
      project.override_justification = null;
    } else if (project.priority_override && project.override_value != null) {
      project.priority_score = project.override_value;
    } else {
      project.priority_score = newScore;
    }

    project.updated_at = new Date();
    const saved = await projectRepo.save(project);

    // Log scoring change as activity
    await this.logScoringChange(mg, {
      target: { project_id: projectId },
      tenantId,
      userId,
      before,
      after: saved,
    });

    await this.audit.log({
      table: 'portfolio_projects',
      recordId: projectId,
      action: 'update',
      before,
      after: saved,
      userId,
    }, { manager: mg });

    return saved;
  }

  /**
   * Set or clear manual priority override for a project
   */
  async setProjectOverride(
    projectId: string,
    enabled: boolean,
    value: number | null,
    justification: string | null,
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const projectRepo = mg.getRepository(PortfolioProject);
    if (!userId) throw new BadRequestException('userId is required for change activity logging');

    const project = await projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    // Cannot update scoring on terminal projects
    if (project.status === 'done' || project.status === 'cancelled') {
      throw new BadRequestException('Cannot update scoring on completed or cancelled projects');
    }

    // Check if mandatory bypass is active
    const settings = await this.getSettings(tenantId, mg);
    const bypassActive = await this.isMandatoryBypassActive(
      project.criteria_values || {},
      tenantId,
      settings,
      mg
    );

    if (bypassActive && enabled) {
      throw new BadRequestException(
        'Cannot enable manual override when mandatory bypass is active'
      );
    }

    const before = { ...project };

    if (enabled) {
      if (value == null || value < 0 || value > 100) {
        throw new BadRequestException('Override value must be between 0 and 100');
      }
      if (!justification || !String(justification).trim()) {
        throw new BadRequestException('Override justification is required');
      }

      project.priority_override = true;
      project.override_value = value;
      project.override_justification = String(justification).trim();
      project.priority_score = value;
    } else {
      project.priority_override = false;
      project.override_value = null;
      project.override_justification = null;
      // Recalculate score
      project.priority_score = await this.calculateScoreFromCriteria(
        project.criteria_values || {},
        tenantId,
        { manager: mg }
      );
    }

    project.updated_at = new Date();
    const saved = await projectRepo.save(project);

    const changedFields: Record<string, [unknown, unknown]> = {};
    for (const change of detectChanges(
      before as unknown as Record<string, unknown>,
      saved as unknown as Record<string, unknown>,
      OVERRIDE_FIELDS,
    )) {
      changedFields[change.field] = [change.before, change.after];
    }
    if (Object.keys(changedFields).length > 0) {
      await mg.getRepository(PortfolioActivity).save({
        project_id: projectId,
        tenant_id: tenantId,
        author_id: userId,
        type: 'change',
        changed_fields: changedFields,
      });
    }

    await this.audit.log({
      table: 'portfolio_projects',
      recordId: projectId,
      action: 'update',
      before,
      after: saved,
      userId,
    }, { manager: mg });

    return saved;
  }

  private async getSettings(
    tenantId: string,
    mg: EntityManager,
  ): Promise<PortfolioSettings> {
    const repo = mg.getRepository(PortfolioSettings);
    let settings = await repo.findOne({ where: { tenant_id: tenantId } });

    if (!settings) {
      settings = repo.create({
        tenant_id: tenantId,
        mandatory_bypass_enabled: false,
      });
      settings = await repo.save(settings);
    }

    return settings;
  }

  private async isMandatoryBypassActive(
    criteriaValues: Record<string, string>,
    tenantId: string,
    settings: PortfolioSettings,
    mg: EntityManager,
  ): Promise<boolean> {
    if (!settings.mandatory_bypass_enabled) return false;

    const valueIds = Object.values(criteriaValues).filter(Boolean);
    if (valueIds.length === 0) return false;

    const result = await mg.query(
      `SELECT id FROM portfolio_criterion_values
       WHERE id = ANY($1) AND tenant_id = $2 AND triggers_mandatory_bypass = true`,
      [valueIds, tenantId]
    );

    return result.length > 0;
  }

  /**
   * Recalculate scores for all requests affected by criterion change
   */
  private async recalculateScoresForCriterion(
    criterionId: string,
    tenantId: string,
    mg: EntityManager,
  ) {
    // Find requests that have this criterion in their values
    const requests = await mg.query(
      `SELECT id FROM portfolio_requests
       WHERE tenant_id = $1
       AND criteria_values ? $2
       AND status != 'converted'`,
      [tenantId, criterionId]
    );

    for (const req of requests) {
      await this.recalculateSingleRequest(req.id, tenantId, mg);
    }
  }

  /**
   * Recalculate scores for all non-converted requests
   */
  private async recalculateAllScores(tenantId: string, mg: EntityManager) {
    const requests = await mg.query(
      `SELECT id FROM portfolio_requests
       WHERE tenant_id = $1 AND status != 'converted'`,
      [tenantId]
    );

    for (const req of requests) {
      await this.recalculateSingleRequest(req.id, tenantId, mg);
    }
  }

  private async recalculateSingleRequest(
    requestId: string,
    tenantId: string,
    mg: EntityManager,
  ) {
    const requestRepo = mg.getRepository(PortfolioRequest);
    const request = await requestRepo.findOne({ where: { id: requestId } });

    if (!request) return;
    if (request.priority_override) return; // Don't override manual scores

    const newScore = await this.calculateScore(requestId, tenantId, { manager: mg });
    request.priority_score = newScore;
    request.updated_at = new Date();
    await requestRepo.save(request);
  }

  // ==================== EFFORT CALCULATION FROM CRITERIA ====================

  /**
   * Calculate effort estimates from Time estimation criteria values.
   * This is used when converting a request to a project.
   *
   * @returns Object with estimated_effort_it and estimated_effort_business (both in man-days)
   */
  async calculateEffortFromCriteria(
    criteriaValues: Record<string, string>,
    tenantId: string,
    opts?: { manager?: EntityManager },
  ): Promise<{ estimated_effort_it: number | null; estimated_effort_business: number | null }> {
    const mg = opts?.manager ?? this.repo.manager;
    const criteriaRepo = mg.getRepository(PortfolioCriterion);
    const valuesRepo = mg.getRepository(PortfolioCriterionValue);

    // Find Time estimation criteria by system_key
    const timeEstimationCriteria = await criteriaRepo.find({
      where: [
        { tenant_id: tenantId, system_key: 'time_estimation_it' },
        { tenant_id: tenantId, system_key: 'time_estimation_business' },
      ],
    });

    let estimatedEffortIt: number | null = null;
    let estimatedEffortBusiness: number | null = null;

    for (const criterion of timeEstimationCriteria) {
      const selectedValueId = criteriaValues[criterion.id];
      if (!selectedValueId) continue;

      // Get the selected value
      const selectedValue = await valuesRepo.findOne({ where: { id: selectedValueId } });
      if (!selectedValue) continue;

      // Parse the label to get effort
      const effort = this.parseEffortFromLabel(selectedValue.label);

      if (criterion.system_key === 'time_estimation_it') {
        estimatedEffortIt = effort;
      } else if (criterion.system_key === 'time_estimation_business') {
        estimatedEffortBusiness = effort;
      }
    }

    return {
      estimated_effort_it: estimatedEffortIt,
      estimated_effort_business: estimatedEffortBusiness,
    };
  }

  /**
   * Parse an effort range label (e.g., "10-20 MD", ">50 MD") to a single effort value.
   * Uses middle of range for normal ranges, and low + 50% for open-ended ranges.
   */
  private parseEffortFromLabel(label: string): number | null {
    if (!label) return null;

    // Handle open-ended range like ">50 MD"
    const openMatch = label.match(/^>(\d+)/);
    if (openMatch) {
      const low = parseInt(openMatch[1], 10);
      return low + (low * 0.5); // e.g., >50 -> 75
    }

    // Handle normal range like "10-20 MD" or "0-10 MD"
    const rangeMatch = label.match(/^(\d+)-(\d+)/);
    if (rangeMatch) {
      const low = parseInt(rangeMatch[1], 10);
      const high = parseInt(rangeMatch[2], 10);
      return (low + high) / 2; // e.g., 10-20 -> 15
    }

    return null;
  }

  // ==================== DEFAULT CRITERIA SEEDING ====================

  /**
   * Seed default evaluation criteria for a new tenant, in its seed language.
   * Based on specification section 4.5 "Default Criteria".
   */
  private async seedDefaultCriteria(tenantId: string, mg: EntityManager) {
    const criteriaRepo = mg.getRepository(PortfolioCriterion);
    const valuesRepo = mg.getRepository(PortfolioCriterionValue);

    // Named in the workspace seed language (`metadata.language`), English when absent.
    const [tenant] = await mg.query(`SELECT metadata FROM tenants WHERE id = $1`, [tenantId]);
    const defaultCriteria = defaultCriteriaIn(tenantSeedLanguage(tenant?.metadata));

    for (let i = 0; i < defaultCriteria.length; i++) {
      const def = defaultCriteria[i];

      // Create criterion
      const criterion = criteriaRepo.create({
        tenant_id: tenantId,
        name: def.name,
        system_key: def.system_key || null,
        enabled: true,
        inverted: def.inverted,
        weight: def.weight,
        display_order: i,
      });
      const savedCriterion = await criteriaRepo.save(criterion);

      // Create values
      for (let j = 0; j < def.values.length; j++) {
        const v = def.values[j];
        const value = valuesRepo.create({
          tenant_id: savedCriterion.tenant_id,
          criterion_id: savedCriterion.id,
          label: v.label,
          position: j,
          triggers_mandatory_bypass: v.triggers_mandatory_bypass === true,
        });
        await valuesRepo.save(value);
      }
    }
  }
}
