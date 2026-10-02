import { forwardRef } from 'react';
import ItemRelationsPanel, { type RelationsPanelHandle } from '../../../components/finance/ItemRelationsPanel';

export type { RelationsPanelHandle };

type Props = { id: string; autoSave?: boolean; onDirtyChange?: (dirty: boolean) => void; onRelationsChange?: () => void };

/** The CAPEX line's Relations tab (shared with OPEX: components/finance/ItemRelationsPanel). */
export default forwardRef<RelationsPanelHandle, Props>(function RelationsPanel(props, ref) {
  return <ItemRelationsPanel {...props} kind="capex" ref={ref} />;
});
