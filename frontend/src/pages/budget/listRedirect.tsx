import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { loadListContext, parseListFilters, saveListContext, type ListFilters } from '../../lib/listContext';

type Nature = 'opex' | 'capex';

function transformFilters(filters: ListFilters | null, nature: Nature): ListFilters {
  const next = { ...filters };
  if (nature === 'capex') {
    if (Object.prototype.hasOwnProperty.call(next, 'description')) {
      next.product_name = next.description;
      delete next.description;
    }
    delete next.item_number;
  }
  next.nature = { filterType: 'set', values: [nature] };
  return next;
}

/** Old list addresses keep their state, translated to the native line fields and numbering. */
export async function budgetListRedirectSearch(search: string, nature: Nature): Promise<string> {
  const sp = new URLSearchParams(search);
  const inline = parseListFilters(sp.get('filters'));
  const ctx = sp.get('ctx');
  sp.delete('ctx');
  const sort = sp.get('sort');
  if (nature === 'capex') {
    if (sort?.split(':')[0] === 'description') sp.set('sort', sort.replace(/^description:/, 'product_name:'));
    if (sort?.split(':')[0] === 'item_number') sp.delete('sort');
    if (/^CPX-\d+$/i.test(sp.get('q')?.trim() ?? '')) sp.delete('q');
  }
  let filters = transformFilters(inline, nature);
  if (ctx) {
    try {
      const saved = await loadListContext(ctx);
      const expectedList = nature === 'opex' ? 'spend-items' : 'capex-items';
      if (saved.list !== expectedList) throw new Error('Unexpected list context');
      filters = transformFilters({ ...saved.filters, ...inline }, nature);
      const id = await saveListContext('/budget-lines/summary', filters);
      sp.delete('filters');
      sp.set('ctx', id);
      return sp.toString();
    } catch {
      // A missing context opens the right nature, preserving the remaining URL parameters.
    }
  }
  sp.set('filters', JSON.stringify(filters));
  return sp.toString();
}

export default function BudgetListRedirect({ nature }: { nature: Nature }) {
  const { search } = useLocation();
  const [target, setTarget] = useState<{ source: string; nature: Nature; search: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void budgetListRedirectSearch(search, nature).then((next) => {
      if (!cancelled) setTarget({ source: search, nature, search: next });
    });
    return () => { cancelled = true; };
  }, [nature, search]);
  return target?.source === search && target.nature === nature
    ? <Navigate replace to={`/ops/budget?${target.search}`} />
    : null;
}
