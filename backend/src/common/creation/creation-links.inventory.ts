/**
 * The cascade children of a record being created that do not stop "Cancel", each with its reason
 * (`creation-links.ts` lists those that do). A child is one of four cases, which
 * `__tests__/creation-links.inventory.integration.spec.ts` checks against the database, foreign key
 * by foreign key, for every family with a "Cancel" of its creation: declared in
 * `CREATION_CANCEL_LINKS`; read by the family's history (`children`, `childReads` of
 * `record-history.inventory.ts`), for a table with a single column towards the family; or kept
 * here, its delete refusing it or another reason. A table with two columns towards the family is
 * audited on one side only: each column is declared or kept. A new cascade key nobody classified
 * fails that spec.
 *
 * Keys: `<child>.<column>` for a column that names the record, or
 * `<child>.<column>><grandchild>.<column>` for a table that references one of the record's own
 * children (checked under every child that is not declared and whose delete does not refuse).
 */

const DELETE_REFUSES = 'the delete refuses';
const OWN_PAGE = (what: string) => `written from the record's own page (${what}), audited on the record: the history reads it`;

export const CREATION_CANCEL_KEPT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  applications: {
    'interfaces.source_application_id': `${DELETE_REFUSES} an application an interface comes from (APPLICATION_HAS_INTERFACES)`,
    'interfaces.target_application_id': `${DELETE_REFUSES} an application an interface goes to (APPLICATION_HAS_INTERFACES)`,
    'application_suites.application_id': OWN_PAGE('its suites, `bulkReplaceSuites`'),
    'app_instances.application_id>interface_bindings.source_instance_id': `a binding names an instance of an interface's own applications: ${DELETE_REFUSES} (APPLICATION_HAS_INTERFACES)`,
    'app_instances.application_id>interface_bindings.target_instance_id': `a binding names an instance of an interface's own applications: ${DELETE_REFUSES} (APPLICATION_HAS_INTERFACES)`,
  },
  assets: {
    'app_asset_assignments.asset_id': `${DELETE_REFUSES} an asset assigned to an application (ASSET_IN_USE)`,
    'connection_servers.asset_id': `${DELETE_REFUSES} an asset of a connection (ASSET_IN_USE)`,
    'asset_cluster_members.cluster_id': OWN_PAGE('the members of a cluster'),
    'asset_relations.asset_id': OWN_PAGE('its relations'),
  },
  connections: {
    'connection_protocols.connection_id': 'written by the connection\'s own create and update, whose audit row the history reads',
    'connection_servers.connection_id': 'written by the connection\'s own create and update, whose audit row the history reads',
  },
  contracts: {
    'contract_tasks.contract_id': 'duplicate of the `tasks` row the same call writes, which the history reads',
  },
  documents: {
    'document_versions.document_id': 'written by the document\'s own save, whose audit row the history reads',
    'document_references.source_document_id': 'derived from the document\'s own content on each save',
    'document_contributors.document_id': 'the owner is written by the creation; a change rides in the document\'s save',
    'document_classifications.document_id': 'the template\'s classifications are written by the creation',
    'integrated_document_bindings.document_id': 'a managed document is provisioned by its record, not by the document\'s creator',
  },
  interfaces: {
    'interface_middleware_applications.interface_id': 'written by the interface\'s own create and update, whose audit row the history reads',
    'interface_dependencies.interface_id': OWN_PAGE('its dependencies'),
  },
  portfolio_projects: {
    'portfolio_request_projects.project_id': `${DELETE_REFUSES} a project that came from a request (PROJECT_FROM_REQUEST)`,
    'portfolio_project_dependencies.project_id': OWN_PAGE('its dependencies'),
  },
  portfolio_requests: {
    'portfolio_request_projects.request_id': 'its writers log the request\'s own row (a source request linked) or convert it, and the delete refuses a converted request (REQUEST_CONVERTED)',
    'portfolio_request_dependencies.request_id': OWN_PAGE('its dependencies'),
  },
  spend_items: {
    'spend_tasks.item_id': 'duplicate of the `tasks` row the same call writes, which the history reads',
    'spend_item_analytics_values.item_id': 'the dimension values ride in the audit row of the line',
    'spend_versions.spend_item_id>spend_version_totals.version_id': 'totals derived from the amounts by the database',
  },
};
