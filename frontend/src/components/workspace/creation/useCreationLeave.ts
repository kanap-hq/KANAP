import React from 'react';
import { useNavigate } from 'react-router-dom';
import useCreationReturn from './useCreationReturn';

/**
 * Leaves a new record's page (Create done, Cancel, Escape on the empty title): back where the
 * creation started (`useCreationReturn`), else through `fallback`, the page's own close (its list
 * with the list's context).
 */
export default function useCreationLeave(fallback: () => void): () => void {
  const navigate = useNavigate();
  const creationReturn = useCreationReturn('');
  return React.useCallback(() => {
    if (creationReturn) navigate(creationReturn);
    else fallback();
  }, [creationReturn, fallback, navigate]);
}
