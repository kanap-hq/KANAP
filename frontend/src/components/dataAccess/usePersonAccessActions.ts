import React from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import type { AccessNode, AccessNodeInput, DataAccessLevel, PersonAccess } from './dataAccess';

const nodeKey = (node: Pick<AccessNode, 'type' | 'id'>) => `${node.type}:${node.id ?? ''}`;

/** Reads a person's access, sends one changed node set, and reports an inline refusal. */
export function usePersonAccessActions(onChanged: () => void) {
  const { t } = useTranslation(['admin', 'common']);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const run = async (personId: string, change: (nodes: AccessNodeInput[]) => AccessNodeInput[]) => {
    setPending(personId);
    setError(null);
    try {
      const res = await api.get<PersonAccess>(`/users/${personId}/data-access`);
      const current: AccessNodeInput[] = (res.data?.nodes ?? []).map((node) => ({
        type: node.type,
        id: node.id,
        access: node.access,
      }));
      await api.put(`/users/${personId}/data-access`, { mode: 'limited', nodes: change(current) });
      onChanged();
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('admin:dataAccess.accessTab.saveFailed')));
    } finally {
      setPending(null);
    }
  };

  /** Adds the node, or replaces its access when the person already holds it. */
  const setNode = (personId: string, node: AccessNode, access: DataAccessLevel) => run(personId, (nodes) => [
    ...nodes.filter((current) => nodeKey(current) !== nodeKey(node)),
    { type: node.type, id: node.id, access },
  ]);

  const changeAccess = (personId: string, node: AccessNode, access: DataAccessLevel) => run(personId, (nodes) => nodes.map(
    (current) => (nodeKey(current) === nodeKey(node) ? { ...current, access } : current),
  ));

  const removeNode = (personId: string, node: AccessNode) => run(personId, (nodes) => nodes.filter(
    (current) => nodeKey(current) !== nodeKey(node),
  ));

  return { pending, error, setError, setNode, changeAccess, removeNode };
}
