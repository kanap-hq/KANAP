import { SeedLanguage } from '../analytics/recommended-dimensions.seed';
import * as seedFile from './default-criteria.labels.json';

/**
 * The evaluation criteria a workspace starts with, named in the workspace seed language
 * (`metadata.language`), English when it holds none. Seeded on the first read of the list
 * (`PortfolioCriteriaService.seedDefaultCriteria`).
 *
 * Amounts keep their figures (`0-10k€`). Durations keep their figures and translate the unit
 * (`>10y`, `0-10 MD`: the effort unit is the one the portfolio already shows, JH, PT, DP).
 * The two time estimates keep `system_key`. A workspace that already has criteria keeps them:
 * a later change of language does not rewrite the stored names.
 */

type SeedText = Record<SeedLanguage, string>;

interface RawValue {
  label: SeedText;
  triggers_mandatory_bypass?: boolean;
}

interface RawCriterion {
  name: SeedText;
  system_key?: string;
  inverted: boolean;
  weight: number;
  values: RawValue[];
}

export interface DefaultCriterionSeed {
  name: string;
  system_key?: string;
  inverted: boolean;
  weight: number;
  values: Array<{ label: string; triggers_mandatory_bypass?: boolean }>;
}

const RAW = (seedFile as { criteria: RawCriterion[] }).criteria;

/** The default criteria with names and labels in `language`, in seed order. */
export function defaultCriteriaIn(language: SeedLanguage): DefaultCriterionSeed[] {
  return RAW.map((criterion) => ({
    name: criterion.name[language],
    ...(criterion.system_key ? { system_key: criterion.system_key } : {}),
    inverted: criterion.inverted,
    weight: criterion.weight,
    values: criterion.values.map((value) => ({
      label: value.label[language],
      ...(value.triggers_mandatory_bypass ? { triggers_mandatory_bypass: true } : {}),
    })),
  }));
}
