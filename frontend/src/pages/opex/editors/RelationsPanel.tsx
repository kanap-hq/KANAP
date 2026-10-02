import { forwardRef } from 'react';
import ItemRelationsPanel, { type RelationsPanelHandle } from '../../../components/finance/ItemRelationsPanel';

export type { RelationsPanelHandle };

type Props = { id: string; autoSave?: boolean; onDirtyChange?: (dirty: boolean) => void; onRelationsChange?: () => void };

/** The OPEX line's Relations tab (shared with CAPEX: components/finance/ItemRelationsPanel). */
export default forwardRef<RelationsPanelHandle, Props>(function RelationsPanel(props, ref) {
  return <ItemRelationsPanel {...props} kind="opex" ref={ref} />;
});
