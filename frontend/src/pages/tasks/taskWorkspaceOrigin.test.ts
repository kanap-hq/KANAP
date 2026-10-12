import { describe, expect, it } from 'vitest';
import {
  buildOriginPath,
  buildParentPath,
  buildTaskBreadcrumbs,
  buildTaskOriginSearchParams,
  parseTaskOrigin,
  remapProjectListContext,
  sanitizeOriginTab,
  stripOriginParams,
} from './taskWorkspaceOrigin';

const labels = {
  tasks: 'Tasks',
  typeLabel: (kind: 'project' | 'spend_item' | 'capex_item' | 'contract' | 'incident') => ({
    project: 'Project',
    spend_item: 'OPEX',
    capex_item: 'CAPEX',
    contract: 'Contract',
    incident: 'Incident',
  }[kind]),
};

describe('parseTaskOrigin', () => {
  it('defaults to the task list when no origin params are present', () => {
    expect(parseTaskOrigin(new URLSearchParams('sort=created_at:DESC&q=sap'))).toEqual({ kind: 'tasks' });
  });

  it('reads projectId and sanitizes projectTab', () => {
    expect(parseTaskOrigin(new URLSearchParams('projectId=prj-1&projectTab=timeline'))).toEqual({
      kind: 'project',
      id: 'prj-1',
      tab: 'timeline',
    });
    expect(parseTaskOrigin(new URLSearchParams('projectId=prj-1&projectTab=nope'))).toEqual({
      kind: 'project',
      id: 'prj-1',
      tab: 'tasks',
    });
  });

  it('reads spend/capex/contract ids and whitelists originTab', () => {
    expect(parseTaskOrigin(new URLSearchParams('spendItemId=si-1&originTab=allocations'))).toEqual({
      kind: 'spend_item',
      id: 'si-1',
      tab: 'allocations',
    });
    expect(parseTaskOrigin(new URLSearchParams('capexItemId=cx-1&originTab=garbage'))).toEqual({
      kind: 'capex_item',
      id: 'cx-1',
      tab: 'overview',
    });
    expect(parseTaskOrigin(new URLSearchParams('contractId=ct-1'))).toEqual({
      kind: 'contract',
      id: 'ct-1',
      tab: 'tasks',
    });
    expect(parseTaskOrigin(new URLSearchParams('contractId=ct-1&originTab=not-a-tab'))).toEqual({
      kind: 'contract',
      id: 'ct-1',
      tab: 'tasks',
    });
  });

  it('reads incident ids by business ref and defaults to the relations tab', () => {
    expect(parseTaskOrigin(new URLSearchParams('incidentId=INC-12&originTab=journal'))).toEqual({
      kind: 'incident',
      id: 'INC-12',
      tab: 'journal',
    });
    expect(parseTaskOrigin(new URLSearchParams('incidentId=INC-12&originTab=tasks'))).toEqual({
      kind: 'incident',
      id: 'INC-12',
      tab: 'relations',
    });
    expect(buildOriginPath({ kind: 'incident', id: 'INC-12', tab: 'journal' }, new URLSearchParams()))
      .toBe('/it/incidents/INC-12/journal');
    expect(buildParentPath('incident', 'INC-12')).toBe('/it/incidents/INC-12/overview');
  });

  it('prefers projectId when multiple origin ids are present', () => {
    expect(parseTaskOrigin(new URLSearchParams('projectId=prj-1&spendItemId=si-1')).kind).toBe('project');
  });
});

describe('sanitizeOriginTab', () => {
  it('keeps known tabs and falls back per kind', () => {
    expect(sanitizeOriginTab('project', 'effort')).toBe('effort');
    expect(sanitizeOriginTab('project', 'activity')).toBe('activity');
    expect(sanitizeOriginTab('spend_item', 'relations')).toBe('relations');
    expect(sanitizeOriginTab('contract', 'details')).toBe('details');
    expect(sanitizeOriginTab('contract', '')).toBe('tasks');
    expect(sanitizeOriginTab('spend_item', 'tasks')).toBe('overview');
  });
});

describe('stripOriginParams / remapProjectListContext', () => {
  it('strips every origin key including phaseId and project* context', () => {
    const search = new URLSearchParams([
      ['sort', 'created_at:DESC'],
      ['q', 'sap'],
      ['filters', '{}'],
      ['projectId', 'prj-1'],
      ['projectTab', 'tasks'],
      ['projectSort', 'name:ASC'],
      ['projectQ', 'mig'],
      ['projectFilters', 'x'],
      ['projectScope', 'my'],
      ['projectInvolvedUserId', 'u-1'],
      ['projectInvolvedTeamId', 't-1'],
      ['spendItemId', 'si-1'],
      ['capexItemId', 'cx-1'],
      ['contractId', 'ct-1'],
      ['originTab', 'overview'],
      ['phaseId', 'ph-1'],
      ['taskStatus', 'open'],
      ['taskPhase', 'project-level'],
    ]);

    const stripped = stripOriginParams(search);
    expect(stripped.toString()).toBe('sort=created_at%3ADESC&q=sap&filters=%7B%7D');
  });

  it('remaps project* list context back onto the project workspace query', () => {
    const remapped = remapProjectListContext(new URLSearchParams([
      ['projectSort', 'name:ASC'],
      ['projectQ', 'mig'],
      ['projectFilters', 'x'],
      ['projectScope', 'my'],
      ['projectInvolvedUserId', 'u-1'],
      ['projectInvolvedTeamId', 't-1'],
    ]));
    expect(Object.fromEntries(remapped.entries())).toEqual({
      sort: 'name:ASC',
      q: 'mig',
      filters: 'x',
      projectScope: 'my',
      involvedUserId: 'u-1',
      involvedTeamId: 't-1',
    });
  });

  it('forwards task list filters onto the project workspace query', () => {
    const remapped = remapProjectListContext(new URLSearchParams('taskStatus=open&taskPhase=phase-1'));
    expect(Object.fromEntries(remapped.entries())).toEqual({
      taskStatus: 'open',
      taskPhase: 'phase-1',
    });
  });
});

describe('buildOriginPath / buildParentPath', () => {
  it('returns the task list without leaking origin params', () => {
    const search = new URLSearchParams('sort=due_date:ASC&spendItemId=si-1&originTab=overview&phaseId=ph-1');
    expect(buildOriginPath({ kind: 'tasks' }, search)).toBe('/portfolio/tasks?sort=due_date%3AASC');
  });

  it('returns the project workspace with remapped list context', () => {
    const search = new URLSearchParams('projectId=prj-1&projectTab=timeline&projectSort=name:ASC');
    expect(buildOriginPath({ kind: 'project', id: 'prj-1', tab: 'timeline' }, search))
      .toBe('/portfolio/projects/prj-1/timeline?sort=name%3AASC');
  });

  it('returns budget/contract workspaces on a whitelisted tab', () => {
    expect(buildOriginPath({ kind: 'spend_item', id: 'si-1', tab: 'allocations' }, new URLSearchParams()))
      .toBe('/ops/budget/si-1/allocations');
    expect(buildOriginPath({ kind: 'capex_item', id: 'cx-1', tab: 'nope' }, new URLSearchParams()))
      .toBe('/ops/budget/cx-1/overview');
    expect(buildOriginPath({ kind: 'contract', id: 'ct-1' }, new URLSearchParams()))
      .toBe('/ops/contracts/ct-1/tasks');
  });

  it('preserves task list filters on entity origin paths and strips them on the task list', () => {
    const search = new URLSearchParams('taskStatus=open&taskPhase=phase-1&spendItemId=si-1');
    expect(buildOriginPath({ kind: 'project', id: 'prj-1', tab: 'tasks' }, search))
      .toBe('/portfolio/projects/prj-1/tasks?taskStatus=open&taskPhase=phase-1');
    expect(buildOriginPath({ kind: 'spend_item', id: 'si-1', tab: 'overview' }, search))
      .toBe('/ops/budget/si-1/overview?taskStatus=open&taskPhase=phase-1');
    expect(buildOriginPath({ kind: 'tasks' }, search)).toBe('/portfolio/tasks');
  });

  it('jumps parents to the entity home tab', () => {
    expect(buildParentPath('project', 'prj-1')).toBe('/portfolio/projects/prj-1/summary');
    expect(buildParentPath('spend_item', 'si-1')).toBe('/ops/budget/si-1/overview');
    expect(buildParentPath('capex_item', 'cx-1')).toBe('/ops/budget/cx-1/overview');
    expect(buildParentPath('contract', 'ct-1')).toBe('/ops/contracts/ct-1/overview');
  });
});

describe('buildTaskOriginSearchParams', () => {
  it('captures project list context and the current project tab', () => {
    const params = buildTaskOriginSearchParams('project', 'prj-1', {
      pathname: '/portfolio/projects/prj-1/timeline',
      search: '?sort=name:ASC&q=sap&projectScope=my',
    });
    expect(Object.fromEntries(params.entries())).toEqual({
      projectId: 'prj-1',
      projectTab: 'timeline',
      projectSort: 'name:ASC',
      projectQ: 'sap',
      projectScope: 'my',
    });
  });

  it('captures spend/capex/contract origin tab from the route', () => {
    expect(Object.fromEntries(buildTaskOriginSearchParams('spend_item', 'si-1', {
      pathname: '/ops/opex/si-1/overview',
      search: '',
    }).entries())).toEqual({ spendItemId: 'si-1', originTab: 'overview' });

    expect(Object.fromEntries(buildTaskOriginSearchParams('contract', 'ct-1', {
      pathname: '/ops/contracts/ct-1/tasks',
      search: '',
    }).entries())).toEqual({ contractId: 'ct-1', originTab: 'tasks' });

    expect(buildTaskOriginSearchParams('contract', 'ct-1', {
      pathname: '/ops/contracts/ct-1/not-a-tab',
      search: '',
    }).get('originTab')).toBe('tasks');
  });

  it('copies task list filters onto the task workspace URL', () => {
    const projectParams = buildTaskOriginSearchParams('project', 'prj-1', {
      pathname: '/portfolio/projects/prj-1/tasks',
      search: '?taskStatus=open&taskPhase=phase-1',
    });
    expect(projectParams.get('taskStatus')).toBe('open');
    expect(projectParams.get('taskPhase')).toBe('phase-1');

    const spendParams = buildTaskOriginSearchParams('spend_item', 'si-1', {
      pathname: '/ops/opex/si-1/overview',
      search: '?taskStatus=active',
    });
    expect(spendParams.get('taskStatus')).toBe('active');
  });
});

describe('buildTaskBreadcrumbs', () => {
  it('shows only Tasks for a standalone task opened from the list', () => {
    expect(buildTaskBreadcrumbs({
      origin: { kind: 'tasks' },
      parent: null,
      labels,
    })).toEqual([{
      key: 'origin',
      label: 'Tasks',
      href: '/portfolio/tasks',
      variant: 'back',
    }]);
  });

  it('shows the incident ref and title without an extra type prefix', () => {
    const crumbs = buildTaskBreadcrumbs({
      origin: { kind: 'tasks' },
      parent: { type: 'incident', id: 'inc-1', name: 'INC-1 · Smoke test: mail outage' },
      labels,
    });
    expect(crumbs[1]).toMatchObject({
      key: 'parent',
      label: 'INC-1 · Smoke test: mail outage',
      href: '/it/incidents/inc-1/overview',
    });
  });

  it('adds a clickable project parent when opened from the task list', () => {
    const crumbs = buildTaskBreadcrumbs({
      origin: { kind: 'tasks' },
      parent: { type: 'project', id: 'prj-1', name: 'SAP Cheddar Migration' },
      labels,
    });
    expect(crumbs).toEqual([
      { key: 'origin', label: 'Tasks', href: '/portfolio/tasks', variant: 'back' },
      { key: 'parent', label: 'SAP Cheddar Migration', href: '/portfolio/projects/prj-1/summary', variant: 'link' },
    ]);
  });

  it('prefixes budget and contract parents opened from the task list', () => {
    const crumbs = buildTaskBreadcrumbs({
      origin: { kind: 'tasks' },
      parent: { type: 'spend_item', id: 'si-1', name: 'Microsoft Enterprise' },
      labels,
    });
    expect(crumbs[1]).toMatchObject({
      key: 'parent',
      label: 'OPEX · Microsoft Enterprise',
      href: '/ops/budget/si-1/overview',
    });
  });

  it('dedups when the origin is the same project as the parent', () => {
    const crumbs = buildTaskBreadcrumbs({
      origin: { kind: 'project', id: 'prj-1', tab: 'tasks' },
      parent: { type: 'project', id: 'prj-1', name: 'SAP Cheddar Migration' },
      originName: 'SAP Cheddar Migration',
      labels,
    });
    expect(crumbs).toEqual([{
      key: 'origin',
      label: 'SAP Cheddar Migration',
      href: '/portfolio/projects/prj-1/tasks',
      variant: 'back',
    }]);
  });

  it('dedups a project display ref against the parent UUID when names match', () => {
    const crumbs = buildTaskBreadcrumbs({
      origin: { kind: 'project', id: 'PRJ-6', tab: 'tasks' },
      parent: { type: 'project', id: '990b0739-942a-4eeb-b93d-d36cb1a84975', name: 'SAP Cheddar Migration' },
      originName: 'SAP Cheddar Migration',
      labels,
    });
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0]).toMatchObject({
      key: 'origin',
      label: 'SAP Cheddar Migration',
      href: '/portfolio/projects/PRJ-6/tasks',
    });
  });

  it('does not collapse two different project UUIDs that share a name', () => {
    const crumbs = buildTaskBreadcrumbs({
      origin: { kind: 'project', id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', tab: 'tasks' },
      parent: { type: 'project', id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', name: 'SAP Cheddar Migration' },
      originName: 'SAP Cheddar Migration',
      labels,
    });
    expect(crumbs).toHaveLength(2);
  });

  it('shows only the spend-item name when opened from that OPEX workspace', () => {
    const crumbs = buildTaskBreadcrumbs({
      origin: { kind: 'spend_item', id: 'si-1', tab: 'overview' },
      parent: { type: 'spend_item', id: 'si-1', name: 'Microsoft Enterprise' },
      originName: 'Microsoft Enterprise',
      labels,
    });
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0]).toMatchObject({
      label: 'Microsoft Enterprise',
      href: '/ops/budget/si-1/overview',
    });
  });

  it('keeps a budget origin after prev/next onto a task with a different parent', () => {
    const crumbs = buildTaskBreadcrumbs({
      origin: { kind: 'spend_item', id: 'si-1', tab: 'overview' },
      parent: { type: 'contract', id: 'ct-9', name: 'Azure EA' },
      originName: 'Microsoft Enterprise',
      labels,
    });
    expect(crumbs).toEqual([
      { key: 'origin', label: 'Microsoft Enterprise', href: '/ops/budget/si-1/overview', variant: 'back' },
      { key: 'parent', label: 'Contract · Azure EA', href: '/ops/contracts/ct-9/overview', variant: 'link' },
    ]);
  });

  it('keeps a budget origin when prev/next lands on a task linked to a different spend item', () => {
    const crumbs = buildTaskBreadcrumbs({
      origin: { kind: 'spend_item', id: 'si-1', tab: 'overview' },
      parent: { type: 'spend_item', id: 'si-2', name: 'Slack Business+' },
      originName: 'Microsoft Enterprise',
      labels,
    });
    expect(crumbs[0].label).toBe('Microsoft Enterprise');
    expect(crumbs[1]).toMatchObject({
      label: 'OPEX · Slack Business+',
      href: '/ops/budget/si-2/overview',
    });
  });

  it('falls back to the type label while the origin name is loading', () => {
    const crumbs = buildTaskBreadcrumbs({
      origin: { kind: 'contract', id: 'ct-1', tab: 'tasks' },
      parent: { type: 'project', id: 'prj-1', name: 'SAP Cheddar Migration' },
      labels,
    });
    expect(crumbs[0].label).toBe('Contract');
    expect(crumbs[1].label).toBe('SAP Cheddar Migration');
  });
});


describe('unified budget workspace origins', () => {
  it.each(['spend_item', 'capex_item'] as const)('uses the loaded task kind %s on a neutral route', (type) => {
    const search = buildTaskOriginSearchParams(type, 'BL-127', { pathname: '/ops/budget/BL-127/allocations', search: '' });
    const origin = parseTaskOrigin(search);
    expect(origin).toEqual({ kind: type, id: 'BL-127', tab: 'allocations' });
    expect(buildOriginPath(origin, search)).toBe('/ops/budget/BL-127/allocations');
  });
});
