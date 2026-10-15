import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/**
 * A value a validator refuses: the English message, the code the interface
 * translates and the values its sentence names.
 */
export interface CsvValidationProblem {
  message: string;
  code?: string;
  params?: Record<string, string | number>;
}

/**
 * Validator function type
 */
type ValidatorFn = (
  value: any,
  tenantId: string,
  manager: EntityManager,
) => CsvValidationProblem[] | Promise<CsvValidationProblem[]>;

/**
 * Service for validating JSON fields in CSV imports.
 *
 * Provides named validators that can be referenced in field definitions.
 * Each validator returns the problems it finds (empty = valid).
 */
@Injectable()
export class CsvJsonValidators {
  /** Registered validators */
  private validators: Map<string, ValidatorFn> = new Map();

  constructor() {
    // Register built-in validators
    this.registerBuiltInValidators();
  }

  /**
   * Register a custom validator.
   *
   * @param name - Validator name
   * @param fn - Validation function
   */
  register(name: string, fn: ValidatorFn): void {
    this.validators.set(name, fn);
  }

  /**
   * Validate a value using a named validator.
   *
   * @param validatorName - Name of the validator to use
   * @param value - Value to validate
   * @param tenantId - Current tenant ID
   * @param manager - TypeORM EntityManager
   * @returns The problems found (empty = valid)
   */
  async validate(
    validatorName: string,
    value: any,
    tenantId: string,
    manager: EntityManager,
  ): Promise<CsvValidationProblem[]> {
    const validator = this.validators.get(validatorName);
    if (!validator) {
      return [{ message: `Unknown validator: ${validatorName}` }];
    }

    return validator(value, tenantId, manager);
  }

  /**
   * Register built-in validators.
   */
  private registerBuiltInValidators(): void {
    // Portfolio criteria values validator
    this.register('portfolio_criteria', this.validatePortfolioCriteria.bind(this));

    // Generic object validator (checks it's a plain object)
    this.register('object', this.validateObject.bind(this));

    // Generic array validator (checks it's an array)
    this.register('array', this.validateArray.bind(this));
  }

  /**
   * Validate portfolio criteria values.
   *
   * Expects: { [criterionId: string]: valueId }
   * Validates that all criterion IDs exist in the tenant's portfolio_criteria table.
   */
  private async validatePortfolioCriteria(
    value: any,
    tenantId: string,
    manager: EntityManager,
  ): Promise<CsvValidationProblem[]> {
    const errors: CsvValidationProblem[] = [];

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return [{ message: 'criteria_values must be an object', code: 'CSV_JSON_OBJECT_REQUIRED' }];
    }

    const criterionIds = Object.keys(value);
    if (criterionIds.length === 0) {
      return []; // Empty is valid
    }

    // Load valid criteria for this tenant
    const criteria = await manager.query(
      `SELECT id FROM portfolio_criteria WHERE tenant_id = $1`,
      [tenantId],
    );
    const validIds = new Set(criteria.map((c: any) => c.id));

    // Check each criterion ID
    for (const criterionId of criterionIds) {
      if (!validIds.has(criterionId)) {
        errors.push({
          message: `Unknown criterion ID: ${criterionId}`,
          code: 'CSV_CRITERION_UNKNOWN',
          params: { criterion: criterionId },
        });
      }

      // Also validate the value ID exists for this criterion
      const valueId = value[criterionId];
      if (valueId) {
        const values = await manager.query(
          `SELECT id FROM portfolio_criterion_values WHERE criterion_id = $1 AND tenant_id = $2`,
          [criterionId, tenantId],
        );
        const validValueIds = new Set(values.map((v: any) => v.id));

        if (!validValueIds.has(valueId)) {
          errors.push({
            message: `Invalid value ID ${valueId} for criterion ${criterionId}`,
            code: 'CSV_CRITERION_VALUE_UNKNOWN',
            params: { value: String(valueId), criterion: criterionId },
          });
        }
      }
    }

    return errors;
  }

  /**
   * Validate that value is a plain object.
   */
  private validateObject(value: any): CsvValidationProblem[] {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return [{ message: 'Value must be a plain object', code: 'CSV_JSON_OBJECT_REQUIRED' }];
    }
    return [];
  }

  /**
   * Validate that value is an array.
   */
  private validateArray(value: any): CsvValidationProblem[] {
    if (!Array.isArray(value)) {
      return [{ message: 'Value must be an array', code: 'CSV_JSON_ARRAY_REQUIRED' }];
    }
    return [];
  }
}
