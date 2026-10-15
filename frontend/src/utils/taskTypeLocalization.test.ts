import { describe, expect, it } from 'vitest';
import '../i18n';
import { keepsShippedName, localizeTaskType, taskTypeLabel } from './taskTypeLocalization';

describe('task type localization', () => {
  const task = { id: 'tt-1', name: 'Task', code: 'task', description: 'Standard task or work item' };

  it('shows a shipped type the tenant kept in the user\'s language, name and description', () => {
    expect(localizeTaskType(task, 'fr')).toMatchObject({ name: 'Tâche', description: 'Tâche ou élément de travail standard' });
    expect(localizeTaskType(task, 'de').name).toBe('Aufgabe');
    expect(localizeTaskType(task, 'es').name).toBe('Tarea');
    expect(localizeTaskType(task, 'en')).toBe(task);
    expect(taskTypeLabel('Incident', 'incident', 'de')).toBe('Vorfall');
  });

  it('shows a renamed shipped type, a changed description and a tenant\'s own type as they are stored', () => {
    expect(localizeTaskType({ ...task, name: 'Ticket' }, 'fr')).toMatchObject({ name: 'Ticket', description: 'Tâche ou élément de travail standard' });
    expect(localizeTaskType({ ...task, description: 'Our tasks' }, 'fr')).toMatchObject({ name: 'Tâche', description: 'Our tasks' });
    expect(taskTypeLabel('Task', null, 'fr')).toBe('Task');
    expect(taskTypeLabel('task', 'task', 'fr')).toBe('task');
    expect(taskTypeLabel(null, 'task', 'fr')).toBeNull();
  });

  it('says when a name is the shipped one', () => {
    expect(keepsShippedName('Problem', 'problem')).toBe(true);
    expect(keepsShippedName('Problème', 'problem')).toBe(false);
    expect(keepsShippedName('Problem', null)).toBe(false);
  });
});
