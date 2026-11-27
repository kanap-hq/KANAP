/**
 * The cascade children of a record being created that do not stop "Cancel", each with its reason
 * (`creation-links.ts` lists those that do). A child is one of four cases, which
 * `__tests__/creation-links.inventory.integration.spec.ts` checks against the database for every
 * family with a "Cancel" of its creation: declared in `CREATION_CANCEL_LINKS`; read by the
 * family's history (`children`, `childReads` of `record-history.inventory.ts`); or kept here, its
 * delete refusing it or another reason. A new cascade table nobody classified fails that spec.
 *
 * Keys: the child table (it references the record), or `<child>><grandchild>` for a table that
 * references one of the record's own children (checked under every child that is not declared and
 * whose delete does not refuse).
 */

const DELETE_REFUSES = 'the delete refuses';

export const CREATION_CANCEL_KEPT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  applications: {
    interfaces: `${DELETE_REFUSES} an application an interface comes from or goes to (APPLICATION_HAS_INTERFACES)`,
    'app_instances>interface_bindings': `a binding names an instance of an interface's own applications: ${DELETE_REFUSES} (APPLICATION_HAS_INTERFACES)`,
  },
  assets: {
    app_asset_assignments: `${DELETE_REFUSES} an asset assigned to an application (ASSET_IN_USE)`,
    connection_servers: `${DELETE_REFUSES} an asset of a connection (ASSET_IN_USE)`,
  },
  connections: {
    connection_protocols: 'written by the connection\'s own create and update, whose audit row the history reads',
    connection_servers: 'written by the connection\'s own create and update, whose audit row the history reads',
  },
  contracts: {
    contract_tasks: 'duplicate of the `tasks` row the same call writes, which the history reads',
  },
  documents: {
    document_versions: 'written by the document\'s own save, whose audit row the history reads',
    document_edit_locks: 'the creator\'s own edit lock, taken right after the creation',
    document_references: 'derived from the content on each save of the document',
    document_contributors: 'the owner is written by the creation; a change rides in the document\'s save',
    document_classifications: 'the template\'s classifications are written by the creation',
    document_applications: 'the relations of the address are written by the creation',
    document_assets: 'the relations of the address are written by the creation',
    document_connections: 'the relations of the address are written by the creation',
    document_incidents: 'the relations of the address are written by the creation',
    document_interfaces: 'the relations of the address are written by the creation',
    document_locations: 'the relations of the address are written by the creation',
    document_projects: 'the relations of the address are written by the creation',
    document_requests: 'the relations of the address are written by the creation',
    document_tasks: 'the relations of the address are written by the creation',
    integrated_document_bindings: 'a managed document is provisioned by its record, not by the document\'s creator',
  },
  interfaces: {
    interface_middleware_applications: 'written by the interface\'s own create and update, whose audit row the history reads',
  },
  portfolio_projects: {
    portfolio_request_projects: `${DELETE_REFUSES} a project that came from a request (PROJECT_FROM_REQUEST)`,
  },
  portfolio_requests: {
    portfolio_request_projects: 'its writers log the request\'s own row (a source request linked) or convert it, and the delete refuses a converted request (REQUEST_CONVERTED)',
  },
  spend_items: {
    spend_tasks: 'duplicate of the `tasks` row the same call writes, which the history reads',
    spend_item_analytics_values: 'the dimension values ride in the audit row of the line',
    'spend_versions>spend_version_totals': 'totals derived from the amounts by the database',
  },
};
