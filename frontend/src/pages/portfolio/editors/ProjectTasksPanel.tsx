import React from 'react';
import EntityTasksPanel from '../../../components/EntityTasksPanel';
import { useAuth } from '../../../auth/AuthContext';

type Props = {
  projectId: string;
  /** The project's reference (`PRJ-3`): it names the project in the address of its tasks. */
  projectAddress?: string | null;
  phases?: Array<{ id: string; name: string }>;
  disabled?: boolean;
  onTasksChange?: () => void;
};

export default function ProjectTasksPanel({ projectId, projectAddress, phases = [], disabled = false, onTasksChange }: Props) {
  const { hasLevel } = useAuth();
  // A project's task is created and changed through the project's address, which asks for a
  // contribution to the project; the tasks right (create, delete) is checked by the panel.
  const canContribute = hasLevel('portfolio_projects', 'contributor');

  return (
    <EntityTasksPanel
      entityType="project"
      entityId={projectId}
      entityAddress={projectAddress}
      phases={phases}
      disabled={disabled || !canContribute}
      onTasksChange={onTasksChange}
    />
  );
}
