/**
 * The rich-text fields: every stored text the Markdown editor of a record page
 * edits, and the documents built from such texts.
 *
 * Every write of one of them goes through `normalizeMarkdownRichText` or
 * `normalizeMarkdownWithSearchText` (common/markdown-worker.ts): the text is
 * Markdown, holds no HTML tag outside the accepted list (html-to-markdown.ts,
 * `RICH_TEXT_ALLOWED_HTML`), no inline base64 image, and stays under the size
 * limit. An update passes the stored text (`storedValue`): a write that repeats
 * it is accepted as it is.
 *
 * A new rich-text field is declared here, with every file that checks one of
 * its writes: the service of its domain for the page and the assistant, the
 * `importTransformFn` of its CSV column (`richTextCell`) when it is imported.
 * `rich-text-fields.inventory.spec.ts` fails when a file that checks a
 * rich-text write is missing from this list, and writes each field through its
 * routes.
 */

/** How a write reaches the check: a page of the application, a CSV import, the assistant, a ticket import. */
export type RichTextRoute = 'api' | 'csv' | 'assistant' | 'ticket-import';

export type RichTextField = {
  /** The field, as `table.column`, or the bound document as `documents:<source>/<slot>`. */
  field: string;
  /** The files under `src/` that check a write of the field, with the routes each one serves. */
  checkedIn: Array<{ file: string; routes: RichTextRoute[] }>;
};

export const RICH_TEXT_FIELDS: RichTextField[] = [
  {
    field: 'tasks.description',
    checkedIn: [
      { file: 'tasks/tasks-unified.service.ts', routes: ['api', 'assistant'] },
      { file: 'tasks/task-csv.config.ts', routes: ['csv'] },
      { file: 'ai/mutation/operations/create-task.ai-mutation-operation.ts', routes: ['assistant'] },
      { file: 'ai/mutation/operations/import-glpi-ticket.ai-mutation-operation.ts', routes: ['ticket-import'] },
    ],
  },
  {
    // Comments of tasks, requests and projects, decisions, status updates.
    field: 'portfolio_activities.content',
    checkedIn: [
      { file: 'tasks/task-activities.service.ts', routes: ['api', 'ticket-import'] },
      { file: 'portfolio/portfolio-requests.service.ts', routes: ['api'] },
      { file: 'portfolio/services/portfolio-status.service.ts', routes: ['api'] },
      { file: 'portfolio/services/portfolio-projects-crud.service.ts', routes: ['api'] },
      { file: 'ai/mutation/operations/add-task-comment.ai-mutation-operation.ts', routes: ['assistant'] },
    ],
  },
  {
    field: 'documents.content_markdown',
    checkedIn: [
      { file: 'knowledge/knowledge.service.ts', routes: ['api', 'assistant'] },
      { file: 'ai/mutation/operations/create-document.ai-mutation-operation.ts', routes: ['assistant'] },
      { file: 'ai/mutation/operations/update-document-content.ai-mutation-operation.ts', routes: ['assistant'] },
    ],
  },
  {
    // The documents bound to a record: application overview, incident review, interface
    // specification, request purpose and risks, project purpose.
    field: 'documents:integrated',
    checkedIn: [
      { file: 'knowledge/integrated-documents.service.ts', routes: ['api', 'csv', 'assistant'] },
      { file: 'incidents/incident-csv.config.ts', routes: ['csv'] },
    ],
  },
  {
    // `purpose` and `risks` are stored in the bound documents of the request.
    field: 'portfolio_requests.current_situation, expected_benefits, purpose, risks',
    checkedIn: [
      { file: 'portfolio/portfolio-requests.service.ts', routes: ['api', 'assistant'] },
      { file: 'portfolio/portfolio-request-csv.config.ts', routes: ['csv'] },
    ],
  },
  {
    // Stored in the bound document of the project.
    field: 'portfolio_projects.purpose',
    checkedIn: [
      { file: 'portfolio/services/portfolio-projects-base.service.ts', routes: ['api', 'assistant'] },
      { file: 'portfolio/services/portfolio-projects-crud.service.ts', routes: ['api', 'assistant'] },
      { file: 'portfolio/portfolio-project-csv.config.ts', routes: ['csv'] },
    ],
  },
  {
    // The source of the overview document of the application.
    field: 'applications.description',
    checkedIn: [
      { file: 'applications/services/applications-crud.service.ts', routes: ['api', 'assistant'] },
      { file: 'applications/application-csv.config.ts', routes: ['csv'] },
    ],
  },
  {
    // The texts the specification document of an interface is built from.
    field: 'interfaces.business_purpose, overview_notes and the other specification texts',
    checkedIn: [{ file: 'interfaces/services/interfaces-crud.service.ts', routes: ['api', 'assistant'] }],
  },
  {
    field: 'document_activities.content',
    checkedIn: [{ file: 'knowledge/knowledge.service.ts', routes: ['api'] }],
  },
  {
    field: 'document_workflow_participants.comment',
    checkedIn: [{ file: 'knowledge/knowledge-workflow.service.ts', routes: ['api'] }],
  },
  {
    field: 'contracts.notes',
    checkedIn: [{ file: 'contracts/contracts.service.ts', routes: ['api', 'csv', 'assistant'] }],
  },
  {
    field: 'assets.notes',
    checkedIn: [
      { file: 'assets/services/assets-crud.service.ts', routes: ['api', 'assistant'] },
      { file: 'assets/asset-csv.config.ts', routes: ['csv'] },
    ],
  },
  {
    field: 'locations.additional_info',
    checkedIn: [{ file: 'locations/locations.service.ts', routes: ['api', 'assistant'] }],
  },
  {
    field: 'connections.description',
    checkedIn: [{ file: 'connections/services/connections-crud.service.ts', routes: ['api', 'assistant'] }],
  },
];

/**
 * Files that call the check without writing a field of their own: the check
 * itself, the CSV cell helper, and the comparison of a text with its document.
 */
export const RICH_TEXT_CHECK_HELPERS = [
  'common/markdown-worker.ts',
  'common/markdown-worker.thread.ts',
  'common/markdown-rich-text.ts',
  'common/csv/rich-text-cell.ts',
  'knowledge/integrated-document-bodies.ts',
];
