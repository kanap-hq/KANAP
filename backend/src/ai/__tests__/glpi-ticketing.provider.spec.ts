import { classificationDriftSnapshot, resolvePlannerClassificationProposal } from '../control-plane/providers/ticket-classification';
import * as assert from 'node:assert/strict';
import { GlpiTicketingProvider } from '../control-plane/providers/glpi-ticketing.provider';
import {
  DEFAULT_TICKET_ACTOR_ROLE,
  ProviderContext,
  TicketActorRole,
  ticketActorRoleFromResponsePolicy,
} from '../control-plane/providers/provider.types';

type ActorCall = { ticketId: number; usersId: number; type: number };
type GroupCall = { ticketId: number; groupsId: number };
type TechnicianCall = { ticketId: number; usersId: number };
type ObserverCall = { ticketId: number; id: number };

const ASSIGNABLE_GROUPS = [
  { id: 7, name: 'Tech-desk', completename: 'Tech-desk' },
  { id: 12, name: 'SAP-team', completename: 'Support > SAP-team' },
];

const TECHNICIANS = [
  { id: 303, name: 'atech', label: 'Alice Technician' },
  { id: 404, name: 'mdupont', label: 'Dupont Marie' },
];

function createProvider(options?: { technicianCatalogueFails?: boolean; techniciansTruncated?: boolean }): {
  provider: GlpiTicketingProvider;
  actorCalls: ActorCall[];
  groupCalls: GroupCall[];
  technicianCalls: TechnicianCall[];
  observerGroupCalls: ObserverCall[];
  observerUserCalls: ObserverCall[];
} {
  const actorCalls: ActorCall[] = [];
  const groupCalls: GroupCall[] = [];
  const technicianCalls: TechnicianCall[] = [];
  const observerGroupCalls: ObserverCall[] = [];
  const observerUserCalls: ObserverCall[] = [];
  const observerGroups = new Set<string>(['17:12']);
  const observerUsers = new Set<string>(['17:404']);
  const glpi = {
    listAssignableGroups: async () => ASSIGNABLE_GROUPS,
    listTechnicians: async () => {
      if (options?.technicianCatalogueFails) {
        throw new Error('GLPI refused the user listing (ERROR_RIGHT_MISSING).');
      }
      return { technicians: TECHNICIANS, truncated: options?.techniciansTruncated === true };
    },
    addTicketTechnician: async (_session: unknown, ticketId: number, usersId: number) => {
      technicianCalls.push({ ticketId, usersId });
      const technician = TECHNICIANS.find((candidate) => candidate.id === usersId);
      if (!technician) throw new Error('not a technician');
      return { added: true, alreadyPresent: false, technician };
    },
    // GLPI renders the expanded Ticket_User association as the login, not the display name.
    getTicketUsers: async () => [
      { id: 1, user_id: 202, user_label: 'Bob Requester', role: 'requester' },
      { id: 2, user_id: 303, user_label: 'atech', role: 'assigned' },
      { id: 3, user_id: 909, user_label: 'ext.consultant', role: 'assigned' },
      { id: 4, user_id: 404, user_label: 'mdupont', role: 'observer' },
    ],
    getTicketGroups: async (_session: unknown, ticketId: number) => (ticketId === 17
      ? [
        { id: 5, group_id: 7, group_label: null, role: 'assigned' },
        { id: 6, group_id: 12, group_label: null, role: 'observer' },
      ]
      : []),
    addTicketGroupObserver: async (_session: unknown, ticketId: number, groupsId: number) => {
      observerGroupCalls.push({ ticketId, id: groupsId });
      const group = ASSIGNABLE_GROUPS.find((candidate) => candidate.id === groupsId);
      if (!group) throw new Error('not assignable');
      const key = `${ticketId}:${groupsId}`;
      if (observerGroups.has(key)) return { added: false, alreadyPresent: true, group };
      observerGroups.add(key);
      return { added: true, alreadyPresent: false, group };
    },
    addTicketTechnicianObserver: async (_session: unknown, ticketId: number, usersId: number) => {
      observerUserCalls.push({ ticketId, id: usersId });
      const technician = TECHNICIANS.find((candidate) => candidate.id === usersId);
      if (!technician) throw new Error('not a technician');
      const key = `${ticketId}:${usersId}`;
      if (observerUsers.has(key)) return { added: false, alreadyPresent: true, technician };
      observerUsers.add(key);
      return { added: true, alreadyPresent: false, technician };
    },
    addTicketGroup: async (_session: unknown, ticketId: number, groupsId: number) => {
      groupCalls.push({ ticketId, groupsId });
      const group = ASSIGNABLE_GROUPS.find((candidate) => candidate.id === groupsId);
      if (!group) throw new Error('not assignable');
      return { added: true, alreadyPresent: false, group };
    },
    initSession: async () => ({ sessionToken: 'session-1', baseUrl: 'https://glpi.internal', agentUserId: 42 }),
    killSession: async () => undefined,
    addTicketFollowup: async (_session: unknown, ticketId: number, content: string, opts?: { isPrivate?: boolean }) => ({
      id: 900,
      ticket_id: ticketId,
      content,
      is_private: opts?.isPrivate === true,
    }),
    addTicketUser: async (_session: unknown, ticketId: number, usersId: number, type: number) => {
      actorCalls.push({ ticketId, usersId, type });
      return { added: true, alreadyPresent: false };
    },
  };
  const provider = new GlpiTicketingProvider({} as any, glpi as any);
  return { provider, actorCalls, groupCalls, technicianCalls, observerGroupCalls, observerUserCalls };
}

function context(): ProviderContext {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    isPlatformHost: false,
    surface: 'internal',
    authMethod: 'jwt',
    manager: {} as any,
  } as unknown as ProviderContext;
}

async function publicReplyWith(role: TicketActorRole | undefined): Promise<ActorCall[]> {
  const { provider, actorCalls } = createProvider();
  const result = await provider.addPublicReply(context(), {
    actionPayload: { ticketId: '17', visibility: 'public', body: 'Hello, please restart the printer.', bodyFormat: 'plain_text' },
    idempotencyKey: 'idem-1',
    ...(role ? { agentActorRole: role } : {}),
  });
  assert.equal(result.ok, true, 'public reply write should succeed');
  return actorCalls;
}

async function internalNoteWith(role: TicketActorRole | undefined): Promise<ActorCall[]> {
  const { provider, actorCalls } = createProvider();
  const result = await provider.addInternalNote(context(), {
    actionPayload: { ticketId: '17', visibility: 'internal', body: 'Triage note.', bodyFormat: 'plain_text' },
    idempotencyKey: 'idem-2',
    ...(role ? { agentActorRole: role } : {}),
  });
  assert.equal(result.ok, true, 'internal note write should succeed');
  return actorCalls;
}

async function testPublicReplyDefaultsToAssignee() {
  const calls = await publicReplyWith(undefined);
  assert.deepEqual(calls, [{ ticketId: 17, usersId: 42, type: 2 }]);
}

async function testPublicReplyObserverRoleFollowsOnly() {
  const calls = await publicReplyWith('observer');
  assert.deepEqual(calls, [{ ticketId: 17, usersId: 42, type: 3 }]);
}

async function testPublicReplyNoneRoleNeverTouchesActors() {
  const calls = await publicReplyWith('none');
  assert.deepEqual(calls, []);
}

async function testPublicReplyNoneRoleReportsSkipReasonInEvidence() {
  const { provider } = createProvider();
  const result = await provider.addPublicReply(context(), {
    actionPayload: { ticketId: '17', visibility: 'public', body: 'Hello.', bodyFormat: 'plain_text' },
    idempotencyKey: 'idem-3',
    agentActorRole: 'none',
  });
  assert.equal(result.ok, true);
  const payload = (result.ok ? result.evidence[0]?.redactedPayload : null) as Record<string, unknown>;
  assert.equal(payload.agentAssigneeAdded, false);
  assert.equal(payload.agentAssigneeSkippedReason, 'disabled_by_agent_policy');
}

async function testInternalNoteIsObserverUnlessNone() {
  assert.deepEqual(await internalNoteWith(undefined), [{ ticketId: 17, usersId: 42, type: 3 }]);
  assert.deepEqual(await internalNoteWith('assignee'), [{ ticketId: 17, usersId: 42, type: 3 }]);
  assert.deepEqual(await internalNoteWith('observer'), [{ ticketId: 17, usersId: 42, type: 3 }]);
  assert.deepEqual(await internalNoteWith('none'), []);
}

async function testRoutingContextExposesAssignedGroupsAndCatalogue() {
  const { provider } = createProvider();
  const result = await provider.getTicketRoutingContext(context(), { ticketId: '17' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.assignmentSupported, true);
  // One person, one name: the catalogue label wins over the GLPI login, so the proposal
  // cannot say "Assign to Alice Technician / currently assigned: atech".
  assert.equal(result.data.assignee, 'Alice Technician');
  assert.equal(result.data.group, 'Tech-desk');
  assert.deepEqual(result.data.assignedGroups, [{ kind: 'group', key: '7', label: 'Tech-desk' }]);
  assert.deepEqual(result.data.assignedUsers, [
    { kind: 'user', key: '303', label: 'Alice Technician' },
    // Not in the technician catalogue: the association label is all we have.
    { kind: 'user', key: '909', label: 'ext.consultant' },
  ]);
  // Groups first, then the named technicians: both kinds are routing targets.
  assert.deepEqual(result.data.supportedAssignmentTargets, [
    { kind: 'group', key: '7', label: 'Tech-desk' },
    { kind: 'group', key: '12', label: 'Support > SAP-team' },
    { kind: 'user', key: '303', label: 'Alice Technician' },
    { kind: 'user', key: '404', label: 'Dupont Marie' },
  ]);
  // The agent's own GLPI account, so the pre-write drift check can ignore its own
  // self-registration as an assignee.
  assert.equal(result.data.agentUserKey, '42');
  // The catalogue is prompt input, not ticket evidence.
  const payload = result.evidence[0]?.redactedPayload as Record<string, unknown>;
  assert.equal(payload.supportedAssignmentTargets, undefined);
  assert.equal(payload.supportedAssignmentTargetCount, 4);
}

// A GLPI API profile without READ on User / Group_User must not take group routing down
// with it: the technician catalogue is a partial result, flagged in the warnings.
async function testRoutingContextSurvivesTechnicianCatalogueFailure() {
  const { provider } = createProvider({ technicianCatalogueFails: true });
  const result = await provider.getTicketRoutingContext(context(), { ticketId: '17' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.assignmentSupported, true);
  assert.deepEqual(result.data.supportedAssignmentTargets.map((target) => target.kind), ['group', 'group']);
  assert.equal((result.data.warnings ?? []).includes('glpi_technician_catalogue_unavailable'), true);

  const truncated = await createProvider({ techniciansTruncated: true }).provider
    .getTicketRoutingContext(context(), { ticketId: '17' });
  assert.equal(truncated.ok ? (truncated.data.warnings ?? []).includes('routing_catalog_truncated') : false, true);
}

// Named technicians go through the same catalogue discipline as groups: pick only, label
// from the catalogue, no re-assignment of someone already on the ticket.
async function testPrepareAssignmentAcceptsCatalogueTechnicians() {
  const { provider } = createProvider();
  const prepared = await provider.prepareTicketAssignmentUpdate(context(), {
    ticketId: '17',
    target: { kind: 'user', key: '404', label: 'marie dupont' },
    reason: 'The instructions send badge tickets to Dupont Marie.',
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.deepEqual(prepared.data.actionPayload.target, { kind: 'user', key: '404', label: 'Dupont Marie' });
  assert.deepEqual(prepared.data.actionPayload.providerFields, { users_id: 404, type: 2, operation: 'add' });

  const unknown = await provider.prepareTicketAssignmentUpdate(context(), {
    ticketId: '17',
    target: { kind: 'user', key: '999', label: 'Ghost Technician' },
    reason: 'Invented.',
  });
  assert.equal(unknown.ok, false);
  assert.match(unknown.ok ? '' : unknown.message, /not in the routing catalogue/);
}

async function testUpdateAssignmentWritesTicketUserForTechnician() {
  const { provider, technicianCalls, groupCalls } = createProvider();
  const result = await provider.updateTicketAssignment(context(), {
    actionPayload: {
      ticketId: '17',
      action: 'assignment_update',
      current: { ticketId: '17', supportedAssignmentTargets: [], assignmentSupported: true, supported: true },
      target: { kind: 'user', key: '404', label: 'Dupont Marie' },
      reason: 'Badge tickets go to Dupont Marie.',
    },
    idempotencyKey: 'idem-5',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(technicianCalls, [{ ticketId: 17, usersId: 404 }]);
  assert.deepEqual(groupCalls, []);
  assert.deepEqual(result.data.updatedFields, ['assignment']);
  assert.match(result.data.summary, /assigned to Dupont Marie/);
}

async function testPrepareAssignmentAcceptsCatalogueGroupsOnly() {
  const { provider } = createProvider();
  const prepared = await provider.prepareTicketAssignmentUpdate(context(), {
    ticketId: '17',
    target: { kind: 'group', key: '12', label: 'whatever the model wrote' },
    reason: 'Instructions route SAP questions to SAP-team.',
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  // Label comes from the catalogue, never from the caller; additive write on Group_Ticket type 2.
  assert.deepEqual(prepared.data.actionPayload.target, { kind: 'group', key: '12', label: 'Support > SAP-team' });
  assert.deepEqual(prepared.data.actionPayload.providerFields, { groups_id: 12, type: 2, operation: 'add' });

  const alreadyPresent = await provider.prepareTicketAssignmentUpdate(context(), {
    ticketId: '17',
    target: { kind: 'group', key: '7', label: 'Tech-desk' },
    reason: 'Default queue.',
  });
  assert.equal(alreadyPresent.ok, false);
  assert.match(alreadyPresent.ok ? '' : alreadyPresent.message, /already assigned/);

  const unknown = await provider.prepareTicketAssignmentUpdate(context(), {
    ticketId: '17',
    target: { kind: 'group', key: '99', label: 'Ghost-team' },
    reason: 'Invented.',
  });
  assert.equal(unknown.ok, false);

  // A technician already assigned on the ticket is refused, exactly like a present group.
  const user = await provider.prepareTicketAssignmentUpdate(context(), {
    ticketId: '17',
    target: { kind: 'user', key: '303', label: 'Alice Technician' },
    reason: 'Already there.',
  });
  assert.equal(user.ok, false);
  assert.match(user.ok ? '' : user.message, /already assigned/);
}

async function testUpdateAssignmentWritesGroupTicket() {
  const { provider, groupCalls } = createProvider();
  const result = await provider.updateTicketAssignment(context(), {
    actionPayload: {
      ticketId: '17',
      action: 'assignment_update',
      current: { ticketId: '17', supportedAssignmentTargets: [], assignmentSupported: true, supported: true },
      target: { kind: 'group', key: '12', label: 'Support > SAP-team' },
      reason: 'Route to SAP.',
    },
    idempotencyKey: 'idem-4',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(groupCalls, [{ ticketId: 17, groupsId: 12 }]);
  assert.deepEqual(result.data.updatedFields, ['assignment']);
  assert.match(result.data.summary, /assigned to Support > SAP-team/);
}

async function testParticipantContextListsCurrentObservers() {
  const { provider } = createProvider();
  const result = await provider.getTicketParticipantContext(context(), { ticketId: '17' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.participantUpdatesSupported, true);
  assert.equal(result.data.requester, 'Bob Requester');
  assert.deepEqual(result.data.observers, ['Support > SAP-team', 'Dupont Marie']);
  assert.deepEqual(result.data.observerTargets, [
    { kind: 'group', key: '12', label: 'Support > SAP-team' },
    { kind: 'user', key: '404', label: 'Dupont Marie' },
  ]);
  assert.deepEqual(result.data.watchers, []);
  assert.equal((result.data.warnings ?? []).includes('glpi_watchers_viewers_not_available_in_current_adapter'), true);
  const notes = provider.actionPlannerProfile?.validation_notes ?? [];
  assert.equal(notes.some((note) => note.includes('add_observer') && note.includes('The requester is not changed.')), true);
}

async function testPrepareObserverAcceptsCatalogueTargetsOnly() {
  const { provider } = createProvider();
  const group = await provider.prepareTicketParticipantUpdate(context(), {
    ticketId: '17',
    operation: 'add_observer',
    participants: [{ kind: 'group', key: '7', label: 'whatever the model wrote' }],
    reason: 'Keep Tech-desk informed about the SAP outage.',
  });
  assert.equal(group.ok, true);
  if (!group.ok) return;
  assert.deepEqual(group.data.actionPayload.participants, [{ kind: 'group', key: '7', label: 'Tech-desk' }]);
  assert.deepEqual(group.data.actionPayload.providerFields, { groups_id: 7, type: 3, operation: 'add' });

  const user = await provider.prepareTicketParticipantUpdate(context(), {
    ticketId: '17',
    operation: 'add_observer',
    participants: [{ kind: 'user', key: '303', label: 'alice' }],
    reason: 'Alice follows badge tickets.',
  });
  assert.equal(user.ok, true);
  if (!user.ok) return;
  assert.deepEqual(user.data.actionPayload.participants, [{ kind: 'user', key: '303', label: 'Alice Technician' }]);
  assert.deepEqual(user.data.actionPayload.providerFields, { users_id: 303, type: 3, operation: 'add' });

  const unknown = await provider.prepareTicketParticipantUpdate(context(), {
    ticketId: '17',
    operation: 'add_observer',
    participants: [{ kind: 'group', key: '99', label: 'Ghost-team' }],
    reason: 'Invented.',
  });
  assert.equal(unknown.ok, false);
  assert.match(unknown.ok ? '' : unknown.message, /not in the routing catalogue/);

  const alreadyGroup = await provider.prepareTicketParticipantUpdate(context(), {
    ticketId: '17',
    operation: 'add_observer',
    participants: [{ kind: 'group', key: '12', label: 'Support > SAP-team' }],
    reason: 'Already watching.',
  });
  assert.equal(alreadyGroup.ok, false);
  assert.match(alreadyGroup.ok ? '' : alreadyGroup.message, /already has Support > SAP-team as an observer/);

  const alreadyUser = await provider.prepareTicketParticipantUpdate(context(), {
    ticketId: '17',
    operation: 'add_observer',
    participants: [{ kind: 'user', key: '404', label: 'Dupont Marie' }],
    reason: 'Already watching.',
  });
  assert.equal(alreadyUser.ok, false);
  assert.match(alreadyUser.ok ? '' : alreadyUser.message, /already has Dupont Marie as an observer/);

  const remove = await provider.prepareTicketParticipantUpdate(context(), {
    ticketId: '17',
    operation: 'remove_observer',
    participants: [{ kind: 'user', key: '404', label: 'Dupont Marie' }],
    reason: 'Drop the observer.',
  });
  assert.equal(remove.ok, false);
  assert.match(remove.ok ? '' : remove.message, /Removing an observer is not supported/);
  assert.match(remove.ok ? '' : remove.message, /The requester is not changed/);

  const replace = await provider.prepareTicketParticipantUpdate(context(), {
    ticketId: '17',
    operation: 'set_observers',
    participants: [{ kind: 'group', key: '7', label: 'Tech-desk' }],
    reason: 'Replace the list.',
  });
  assert.equal(replace.ok, false);
  assert.match(replace.ok ? '' : replace.message, /Replacing the observer list is not supported/);
}

async function testUpdateObserverWritesAndSecondCallIsAlreadyApplied() {
  const { provider, observerGroupCalls, observerUserCalls, groupCalls, technicianCalls } = createProvider();
  const groupPayload = {
    ticketId: '17',
    action: 'participant_update' as const,
    operation: 'add_observer' as const,
    current: { ticketId: '17', observers: [], watchers: [], viewers: [], participantUpdatesSupported: true, supported: true },
    participants: [{ kind: 'group' as const, key: '7', label: 'Tech-desk' }],
    reason: 'Keep Tech-desk informed.',
  };
  const firstGroup = await provider.updateTicketParticipants(context(), {
    actionPayload: groupPayload,
    idempotencyKey: 'obs-group-1',
  });
  assert.equal(firstGroup.ok, true);
  if (!firstGroup.ok) return;
  assert.deepEqual(firstGroup.data.updatedFields, ['participants']);
  assert.equal(firstGroup.data.alreadyApplied, false);
  assert.match(firstGroup.data.summary, /observer added: Tech-desk/);

  const secondGroup = await provider.updateTicketParticipants(context(), {
    actionPayload: groupPayload,
    idempotencyKey: 'obs-group-2',
  });
  assert.equal(secondGroup.ok, true);
  if (!secondGroup.ok) return;
  assert.equal(secondGroup.data.alreadyApplied, true);
  assert.deepEqual(secondGroup.data.updatedFields, []);
  assert.match(secondGroup.data.summary, /already had Tech-desk as an observer/);
  assert.deepEqual(observerGroupCalls, [{ ticketId: 17, id: 7 }, { ticketId: 17, id: 7 }]);

  const userPayload = {
    ...groupPayload,
    participants: [{ kind: 'user' as const, key: '303', label: 'Alice Technician' }],
    reason: 'Alice follows this ticket.',
  };
  const firstUser = await provider.updateTicketParticipants(context(), {
    actionPayload: userPayload,
    idempotencyKey: 'obs-user-1',
  });
  assert.equal(firstUser.ok, true);
  if (!firstUser.ok) return;
  assert.deepEqual(firstUser.data.updatedFields, ['participants']);
  assert.equal(firstUser.data.alreadyApplied, false);

  const secondUser = await provider.updateTicketParticipants(context(), {
    actionPayload: userPayload,
    idempotencyKey: 'obs-user-2',
  });
  assert.equal(secondUser.ok, true);
  if (!secondUser.ok) return;
  assert.equal(secondUser.data.alreadyApplied, true);
  assert.deepEqual(secondUser.data.updatedFields, []);
  assert.deepEqual(observerUserCalls, [{ ticketId: 17, id: 303 }, { ticketId: 17, id: 303 }]);
  // Observer writes do not go through the assignment helpers.
  assert.deepEqual(groupCalls, []);
  assert.deepEqual(technicianCalls, []);
}

function testActorRoleParsingFallsBackToDefault() {
  assert.equal(DEFAULT_TICKET_ACTOR_ROLE, 'assignee');
  assert.equal(ticketActorRoleFromResponsePolicy(null), 'assignee');
  assert.equal(ticketActorRoleFromResponsePolicy({}), 'assignee');
  assert.equal(ticketActorRoleFromResponsePolicy({ ticket_actor_role: 'bogus' }), 'assignee');
  assert.equal(ticketActorRoleFromResponsePolicy({ ticket_actor_role: 'observer' }), 'observer');
  assert.equal(ticketActorRoleFromResponsePolicy({ ticket_actor_role: 'none' }), 'none');
}

async function testClassificationCataloguePrepareAndDegradedReads() {
  let failCatalogue = false;
  const categories = [
    ...Array.from({ length: 201 }, (_, i) => ({ id: i + 1, name: `A${i}`, completename: `A${i}`, parentId: null })),
    { id: 300, name: 'Software', completename: 'Software', parentId: null },
    { id: 301, name: 'SAP', completename: 'Software > SAP', parentId: 300 },
  ];
  const writes: any[] = [];
  const provider = new GlpiTicketingProvider({} as any, {
    initSession: async () => ({ sessionToken: 's', baseUrl: 'https://glpi.internal', agentUserId: 42 }),
    killSession: async () => undefined,
    getTicket: async () => ({ id: 17, type: 1, priority: 5, urgency: '3', category_id: 301 }),
    listCategories: async () => { if (failCatalogue) throw new Error('Forbidden'); return categories; },
    updateTicketFields: async (_session: any, id: number, fields: any) => { writes.push(fields); return { ticket_id: id, updated_fields: Object.keys(fields) }; },
  } as any);
  const full = await provider.getTicketClassificationContext(context(), { ticketId: '17' });
  assert.equal(full.ok, true);
  if (!full.ok) return;
  assert.equal(full.data.category, 'Software > SAP');
  assert.equal(full.data.categoryKey, '301');
  assert.equal(full.data.options?.categories.length, 200);
  assert.equal(full.data.categoryCatalogTruncated, true);
  assert.ok(full.warnings?.includes('classification_catalog_truncated'));
  assert.equal((full.evidence[0].redactedPayload as any).options, undefined);
  const scoped = await provider.getTicketClassificationContext(context(), { ticketId: '17', categoryScopeKeys: ['300'] });
  assert.equal(scoped.ok, true);
  if (!scoped.ok) return;
  assert.deepEqual(scoped.data.options?.categories.map((item) => item.key), ['300', '301']);
  assert.equal(scoped.data.categoryCatalogTruncated, false);
  for (const category of ['301', 'software > sap']) {
    const prepared = await provider.prepareTicketClassificationUpdate(context(), { ticketId: '17', proposed: { category, priority: 'high' }, reason: 'Instructions.' });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) continue;
    assert.deepEqual(prepared.data.actionPayload.proposed, { category: 'Software > SAP', categoryKey: '301', priority: 'high' });
    assert.deepEqual(prepared.data.actionPayload.providerFields, { itilcategories_id: 301, priority: 4 });
    assert.equal(prepared.data.actionPayload.current.options, undefined);
    await provider.updateTicketClassification(context(), { actionPayload: prepared.data.actionPayload, idempotencyKey: 'test' });
  }
  assert.equal(writes.length, 2);
  assert.equal((await provider.prepareTicketClassificationUpdate(context(), { ticketId: '17', proposed: { category: 'Ghost' }, reason: 'Instructions.' })).ok, false);
  failCatalogue = true;
  const degraded = await provider.getTicketClassificationContext(context(), { ticketId: '17' });
  assert.equal(degraded.ok, true);
  if (!degraded.ok) return;
  assert.equal(degraded.data.classificationSupported, true);
  assert.equal(degraded.data.categoryKey, '301');
  assert.deepEqual(degraded.data.options?.categories, []);
  assert.ok(degraded.warnings?.includes('glpi_category_catalogue_unavailable'));
  assert.equal((await provider.prepareTicketClassificationUpdate(context(), { ticketId: '17', proposed: { priority: 'high' }, reason: 'Instructions.' })).ok, true);
}

function testClassificationDriftAndUnchangedFields() {
  const current = { ticketId: '17', categoryKey: '301', category: 'SAP', type: 'Incident', priority: 'Very high', urgency: 'Medium', service: 'ERP', impact: 'global' };
  assert.deepEqual(classificationDriftSnapshot(current), classificationDriftSnapshot({ ...current, category: 'Renamed SAP', warnings: ['notice'], options: { categories: [] }, updatedAt: 'later', status: 'pending' }));
  for (const field of ['type', 'priority', 'urgency', 'categoryKey', 'service', 'impact']) {
    assert.notDeepEqual(classificationDriftSnapshot(current), classificationDriftSnapshot({ ...current, [field]: 'changed' }));
  }
  assert.notDeepEqual(classificationDriftSnapshot({ category: 'A' }), classificationDriftSnapshot({ category: 'B' }));
  const classification = { ...current, options: {
    types: [{ key: 'incident', label: 'Incident' }],
    priorities: [{ key: 'very_high', label: 'Very high' }, { key: 'medium', label: 'Medium' }],
    categories: [{ key: '301', label: 'SAP' }],
  } };
  assert.equal(resolvePlannerClassificationProposal(classification, { proposed: { type: 'incident', priority: 'very_high', urgency: 'medium', category: 'sap' } }).reason, 'classification_unchanged');
  assert.equal(resolvePlannerClassificationProposal(classification, { proposed: { category: 'Ghost', unknown: '1' } }).reason, 'classification_field_not_in_catalogue');
}

async function run() {
  await testClassificationCataloguePrepareAndDegradedReads();
  testClassificationDriftAndUnchangedFields();
  await testPublicReplyDefaultsToAssignee();
  await testPublicReplyObserverRoleFollowsOnly();
  await testPublicReplyNoneRoleNeverTouchesActors();
  await testPublicReplyNoneRoleReportsSkipReasonInEvidence();
  await testInternalNoteIsObserverUnlessNone();
  await testRoutingContextExposesAssignedGroupsAndCatalogue();
  await testRoutingContextSurvivesTechnicianCatalogueFailure();
  await testPrepareAssignmentAcceptsCatalogueGroupsOnly();
  await testPrepareAssignmentAcceptsCatalogueTechnicians();
  await testUpdateAssignmentWritesGroupTicket();
  await testUpdateAssignmentWritesTicketUserForTechnician();
  await testParticipantContextListsCurrentObservers();
  await testPrepareObserverAcceptsCatalogueTargetsOnly();
  await testUpdateObserverWritesAndSecondCallIsAlreadyApplied();
  testActorRoleParsingFallsBackToDefault();
  console.log('glpi-ticketing.provider.spec: ok');
}

void run();
