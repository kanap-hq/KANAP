import { EntityManager } from 'typeorm';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import { withSavepoint } from '../common/savepoint.util';
import { canonicalCountry, countryName, holidayLanguage } from './public-holidays';
import { WorkingDayProfilesService } from './working-day-profiles.service';

export interface CompanyStandardCalendarInput {
  /** The company creation's manager: the calendar is written in the same transaction. */
  manager: EntityManager;
  company: { tenant_id?: string | null; country_iso?: string | null };
  userId?: string | null;
  audit: AuditService;
  auditSource?: AuditSourceOptions;
}

export type CompanyStandardCalendarOutcome = 'created' | 'exists' | 'skipped' | 'failed';

/**
 * After a company is created: when its country has public holiday rules and
 * the tenant has no calendar for that whole country yet, creates the standard
 * calendar `{ code: <ISO>, name: <country name in the creator's language,
 * else English> }`. Under its own savepoint and never throwing: a code or
 * name already taken, or any other failure, is logged and the company
 * creation goes on.
 */
export async function createCompanyStandardCalendar(input: CompanyStandardCalendarInput): Promise<CompanyStandardCalendarOutcome> {
  const country = canonicalCountry(input.company?.country_iso);
  if (!country || !input.manager) return 'skipped';
  const { manager } = input;
  try {
    return await withSavepoint(manager, async () => {
      // The company row may come back without its tenant (a database default): the session's tenant is it.
      const tenantId: string | null = input.company.tenant_id
        ?? (await manager.query(`SELECT app_current_tenant() AS tenant_id`))[0]?.tenant_id
        ?? null;
      if (!tenantId) return 'skipped';
      const [existing] = await manager.query(
        `SELECT 1 FROM working_day_profiles
          WHERE tenant_id = $1 AND country_iso = $2 AND region_code IS NULL
          LIMIT 1`,
        [tenantId, country],
      );
      if (existing) return 'exists';
      let lang = 'en';
      if (input.userId) {
        const [user] = await manager.query(
          `SELECT locale FROM users WHERE tenant_id = $1 AND id = $2`,
          [tenantId, input.userId],
        );
        lang = holidayLanguage(user?.locale);
      }
      const calendars = new WorkingDayProfilesService(input.audit);
      await calendars.create(
        { code: country, name: countryName(country, lang), country_iso: country },
        { manager, tenantId, userId: input.userId ?? null, audit: input.auditSource },
      );
      return 'created';
    });
  } catch (err) {
    console.warn(`[working-day-profiles] Standard calendar for ${country} not created:`, (err as Error)?.message ?? err);
    return 'failed';
  }
}
