import type { TFunction } from 'i18next';

/**
 * The libraries and folders KANAP creates in every tenant are stored with an English name. They
 * show in the reader's language while they keep that name; a tenant that renamed one sees its own
 * name. The library is recognised by its slug, the folder by its system key: those keys, never the
 * names, are what the knowledge list filters on (`library_key`, `folder_key`).
 */
const SHIPPED_LIBRARIES: Record<string, { name: string; key: string }> = {
  documents: { name: 'Documents', key: 'documents' },
  templates: { name: 'Templates', key: 'templates' },
  'managed-docs': { name: 'Managed Docs', key: 'managedDocs' },
};

/** The Managed Docs folders (`integrated-document.constants.ts`), by system key. */
const SHIPPED_FOLDERS: Record<string, string> = {
  integrated_requests: 'Requests',
  integrated_projects: 'Projects',
  integrated_interfaces: 'Interfaces',
  integrated_applications: 'Applications',
  integrated_assets: 'Assets',
  integrated_incidents: 'Incidents',
};

type LibraryLike = { slug?: string | null; name?: string | null };
type FolderLike = { system_key?: string | null; name?: string | null };

export function knowledgeLibraryName(t: TFunction, library: LibraryLike | null | undefined): string {
  const name = String(library?.name ?? '');
  const shipped = library?.slug ? SHIPPED_LIBRARIES[library.slug] : undefined;
  if (!shipped || name !== shipped.name) return name;
  return String(t(`knowledge:systemNames.libraries.${shipped.key}`, { defaultValue: name }));
}

export function knowledgeFolderName(t: TFunction, folder: FolderLike | null | undefined): string {
  const name = String(folder?.name ?? '');
  const shipped = folder?.system_key ? SHIPPED_FOLDERS[folder.system_key] : undefined;
  if (!shipped || name !== shipped) return name;
  return String(t(`knowledge:systemNames.folders.${folder!.system_key}`, { defaultValue: name }));
}

/**
 * The label of a `folder_key` filter value: a system key (the tenant cannot rename those folders)
 * shows the folder in the reader's language, any other value is a tenant folder's own name.
 */
export function knowledgeFolderKeyLabel(t: TFunction, key: string): string {
  const shipped = SHIPPED_FOLDERS[key];
  return shipped ? knowledgeFolderName(t, { system_key: key, name: shipped }) : key;
}

/** The labels of the `library_key` filter values (library slugs). */
export function knowledgeLibraryKeyLabels(t: TFunction, libraries: ReadonlyArray<LibraryLike>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const library of libraries) {
    if (library.slug) labels[library.slug] = knowledgeLibraryName(t, library);
  }
  return labels;
}

type FolderTreeNode = FolderLike & { children?: FolderTreeNode[] | null };

/** A folder tree with each folder shown in the reader's language (see `knowledgeFolderName`). */
export function localizeKnowledgeFolderTree<T extends FolderTreeNode>(t: TFunction, nodes: ReadonlyArray<T> | null | undefined): T[] {
  return (nodes ?? []).map((node) => ({
    ...node,
    name: knowledgeFolderName(t, node),
    ...(Array.isArray(node.children) ? { children: localizeKnowledgeFolderTree(t, node.children) } : {}),
  }));
}
