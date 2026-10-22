import { useQuery } from '@tanstack/react-query';
import api from '../../../api';
import type {
  ApplicationRelationRow,
  AssetRelationRow,
  BudgetLineRow,
  BusinessProcessRow,
  ConversionRow,
  TechnologyRelationRow,
} from '../../../components/workspace/relations/types';

export type PortfolioEntity = 'project' | 'request';

export type ProjectRelationsData = {
  year: number;
  budget_column: { key: string; label: string };
  budget_lines: BudgetLineRow[] | null;
  applications: ApplicationRelationRow[] | null;
  assets: AssetRelationRow[] | null;
  technologies: TechnologyRelationRow[] | null;
  source_requests: ConversionRow[] | null;
};

export type RequestRelationsData = {
  year: number;
  budget_column: { key: string; label: string };
  budget_lines: BudgetLineRow[] | null;
  applications: ApplicationRelationRow[] | null;
  assets: AssetRelationRow[] | null;
  processes: BusinessProcessRow[] | null;
  resulting_projects: ConversionRow[] | null;
};

export type PortfolioRelationsData = ProjectRelationsData | RequestRelationsData;

export type PortfolioUrlRow = { id: string; url: string; label: string | null; created_at: string | null };
export type PortfolioFileRow = { id: string; original_filename: string; mime_type?: string | null; size: number | null; created_at: string | null };

/** Web links and files. They are not part of `GET …/relations`; the record returns them with `include`. */
export type PortfolioLinksData = {
  urls: PortfolioUrlRow[];
  attachments: PortfolioFileRow[];
};

const PROJECT_SECTIONS = ['budget_lines', 'applications', 'assets', 'technologies', 'source_requests'] as const;
const REQUEST_SECTIONS = ['budget_lines', 'applications', 'assets', 'processes', 'resulting_projects'] as const;

export const portfolioRelationsKey = (entity: PortfolioEntity, id: string) => ['portfolio-relations', entity, id] as const;
export const portfolioLinksKey = (entity: PortfolioEntity, id: string) => ['portfolio-links-files', entity, id] as const;

export function portfolioBase(entity: PortfolioEntity, id: string): string {
  return entity === 'project' ? `/portfolio/projects/${id}` : `/portfolio/requests/${id}`;
}

export async function fetchPortfolioRelations(entity: PortfolioEntity, id: string): Promise<PortfolioRelationsData> {
  return (await api.get<PortfolioRelationsData>(`${portfolioBase(entity, id)}/relations`)).data;
}

export async function fetchPortfolioLinks(entity: PortfolioEntity, id: string): Promise<PortfolioLinksData> {
  const res = await api.get<Partial<PortfolioLinksData>>(portfolioBase(entity, id), { params: { include: 'urls,attachments' } });
  return { urls: res.data?.urls || [], attachments: res.data?.attachments || [] };
}

function sectionLength(data: object, key: string): number {
  const rows = (data as Record<string, unknown>)[key];
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * The Relations badge. Counts the rows the caller can see on `GET …/relations`
 * (budget lines, applications, assets, technologies or business processes, and the
 * conversion links), plus the dependencies the page already holds, plus the web links
 * and the files. A section left out (`null`) adds nothing. Undefined until the relations
 * payload is in. Links and files add nothing until their own read succeeds.
 */
export function portfolioRelationsCount(
  entity: PortfolioEntity,
  relations: PortfolioRelationsData | undefined,
  links: PortfolioLinksData | undefined,
  dependencies: number,
): number | undefined {
  if (!relations) return undefined;
  const keys = entity === 'project' ? PROJECT_SECTIONS : REQUEST_SECTIONS;
  const sections = keys.reduce((sum, key) => sum + sectionLength(relations, key), 0);
  const extras = links ? (links.urls?.length || 0) + (links.attachments?.length || 0) : 0;
  return sections + dependencies + extras;
}

/** The page and the tab share these two queries, so opening the tab does not read them again. */
export function usePortfolioRelationsBadge(entity: PortfolioEntity, id: string | undefined, dependencies: number): number | undefined {
  const relations = useQuery({
    queryKey: id ? portfolioRelationsKey(entity, id) : ['portfolio-relations', entity, 'pending'],
    queryFn: () => fetchPortfolioRelations(entity, id as string),
    enabled: !!id,
  });
  const links = useQuery({
    queryKey: id ? portfolioLinksKey(entity, id) : ['portfolio-links-files', entity, 'pending'],
    queryFn: () => fetchPortfolioLinks(entity, id as string),
    enabled: !!id,
  });
  return portfolioRelationsCount(entity, relations.data, links.isSuccess ? links.data : undefined, dependencies);
}
