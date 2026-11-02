// Links the corrective tasks of 19b-incident-tasks.csv to the incidents of
// 31-incidents.csv. The file names each incident as INC-N, which is row N of
// the register (1-based). The tenant may already have used those numbers, so
// the link follows the title of that row and the task is imported with the
// incident's id. The CSV file itself stays as INC-N: a load that resets the
// counters can still import it as it is.

const INC_REF = /^INC-(\d+)$/i;

/**
 * Rewrites incident-task rows so `related_object_name` INC-N becomes the id of
 * the incident whose title is row N of the register. A missing title is listed
 * in `warnings` and that task is left out, so the import of the others goes on.
 * Rows that do not name an incident as INC-N are copied unchanged.
 *
 * @param {Array<Record<string, string>>} tasks
 * @param {string[]} registerTitles titles of 31-incidents.csv, in file order
 * @param {Array<{ id: string, title: string }>} incidents
 * @returns {{ rows: Array<Record<string, string>>, warnings: string[] }}
 */
export function rewriteIncidentTaskLinks(tasks, registerTitles, incidents) {
  const idByTitle = new Map();
  for (const incident of incidents ?? []) {
    const title = String(incident?.title ?? '').trim();
    if (title && incident?.id && !idByTitle.has(title)) idByTitle.set(title, incident.id);
  }

  const rows = [];
  const warnings = [];
  for (const task of tasks ?? []) {
    const type = String(task?.related_object_type ?? '').trim().toLowerCase();
    const ref = String(task?.related_object_name ?? '').trim();
    const match = INC_REF.exec(ref);
    if (type !== 'incident' || !match) {
      rows.push({ ...task });
      continue;
    }

    const index = Number(match[1]);
    const title = String(registerTitles?.[index - 1] ?? '').trim();
    const taskTitle = String(task?.title ?? '').trim() || ref;
    if (!title) {
      warnings.push(`No incident title on row ${index} of 31-incidents.csv for task '${taskTitle}' (${ref})`);
      continue;
    }
    const id = idByTitle.get(title);
    if (!id) {
      warnings.push(`Incident '${title}' not found for task '${taskTitle}' (${ref})`);
      continue;
    }
    rows.push({ ...task, related_object_id: id, related_object_name: '' });
  }
  return { rows, warnings };
}
