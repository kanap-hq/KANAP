import React from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useKanapDialogs } from '../design';
import type { AccessNode, AccessNodeInput, DataAccessLevel, PersonAccess } from './dataAccess';

const nodeKey = (node: Pick<AccessNode, 'type' | 'id'>) => `${node.type}:${node.id ?? ''}`;

/** What the tab shows for the person and the node, as the confirmation sentence names them. */
export type PersonAccessNames = { personName: string; nodeName: string };

/** Reads a person's access, sends one changed node set, and reports an inline refusal. */
export function usePersonAccessActions(onChanged: () => void) {
  const { t } = useTranslation(['admin', 'common']);
  const dialogs = useKanapDialogs();
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  /**
   * Reads the stored access, confirms before limiting a person who sees all data, then writes the
   * changed nodes. False when the confirmation was cancelled, so the add form keeps its choice.
   */
  const run = async (
    personId: string,
    change: (nodes: AccessNodeInput[]) => AccessNodeInput[],
    names?: PersonAccessNames,
  ): Promise<boolean> => {
    setPending(personId);
    setError(null);
    try {
      const res = await api.get<PersonAccess>(`/users/${personId}/data-access`);
      // An administrator reads as "all" too, but the server refuses the save: ask nothing.
      if (names && res.data?.mode === 'all' && !res.data?.is_administrator) {
        const confirmed = await dialogs.confirm({
          title: t('admin:dataAccess.allData'),
          message: t('admin:dataAccess.accessTab.confirmLimited', {
            name: names.personName,
            node: names.nodeName,
          }),
          confirmLabel: t('admin:dataAccess.accessTab.addButton'),
        });
        if (!confirmed) return false;
      }
      const current: AccessNodeInput[] = (res.data?.nodes ?? []).map((node) => ({
        type: node.type,
        id: node.id,
        access: node.access,
      }));
      await api.put(`/users/${personId}/data-access`, { mode: 'limited', nodes: change(current) });
      onChanged();
      return true;
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('admin:dataAccess.accessTab.saveFailed')));
      return true;
    } finally {
      setPending(null);
    }
  };

  /** Adds the node, or replaces its access when the person already holds it. */
  const setNode = (
    personId: string,
    node: AccessNode,
    access: DataAccessLevel,
    names?: PersonAccessNames,
  ) => run(personId, (nodes) => [
    ...nodes.filter((current) => nodeKey(current) !== nodeKey(node)),
    { type: node.type, id: node.id, access },
  ], names);

  const changeAccess = (personId: string, node: AccessNode, access: DataAccessLevel) => run(personId, (nodes) => nodes.map(
    (current) => (nodeKey(current) === nodeKey(node) ? { ...current, access } : current),
  ));

  const removeNode = (personId: string, node: AccessNode) => run(personId, (nodes) => nodes.filter(
    (current) => nodeKey(current) !== nodeKey(node),
  ));

  return { pending, error, setError, setNode, changeAccess, removeNode };
}
