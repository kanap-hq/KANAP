import i18next from 'i18next';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import frKnowledge from '../locales/fr/knowledge.json';
import deKnowledge from '../locales/de/knowledge.json';
import esKnowledge from '../locales/es/knowledge.json';
import enKnowledge from '../locales/en/knowledge.json';
import {
  knowledgeFolderKeyLabel,
  knowledgeFolderName,
  knowledgeLibraryKeyLabels,
  knowledgeLibraryName,
  localizeKnowledgeFolderTree,
} from './knowledgeNames';

const instance = i18next.createInstance();
void instance.init({
  lng: 'fr',
  fallbackLng: 'en',
  resources: {
    en: { knowledge: enKnowledge },
    fr: { knowledge: frKnowledge },
    de: { knowledge: deKnowledge },
    es: { knowledge: esKnowledge },
  },
  defaultNS: 'knowledge',
  interpolation: { escapeValue: false },
  initImmediate: false,
});
const tIn = (lng: string) => instance.getFixedT(lng) as unknown as TFunction;
const t = tIn('fr');

describe('knowledge library and folder names', () => {
  it('shows the shipped libraries in the reader language', () => {
    expect(knowledgeLibraryName(t, { slug: 'managed-docs', name: 'Managed Docs' })).toBe('Documents managés');
    expect(knowledgeLibraryName(t, { slug: 'templates', name: 'Templates' })).toBe('Modèles');
    expect(knowledgeLibraryName(tIn('de'), { slug: 'documents', name: 'Documents' })).toBe('Dokumente');
    expect(knowledgeLibraryName(tIn('es'), { slug: 'managed-docs', name: 'Managed Docs' })).toBe('Documentos gestionados');
    expect(knowledgeLibraryName(tIn('en'), { slug: 'managed-docs', name: 'Managed Docs' })).toBe('Managed Docs');
  });

  it('keeps a renamed library and a tenant library as named', () => {
    expect(knowledgeLibraryName(t, { slug: 'documents', name: 'Team handbook' })).toBe('Team handbook');
    expect(knowledgeLibraryName(t, { slug: 'service-desk-docs', name: 'Service Desk Docs' })).toBe('Service Desk Docs');
    // A tenant library that borrowed the name keeps it: the slug says it is not the shipped one.
    expect(knowledgeLibraryName(t, { slug: 'managed-docs-2', name: 'Managed Docs' })).toBe('Managed Docs');
  });

  it('shows the Managed Docs folders in the reader language, tenant folders as named', () => {
    expect(knowledgeFolderName(t, { system_key: 'integrated_requests', name: 'Requests' })).toBe('Demandes');
    expect(knowledgeFolderName(tIn('de'), { system_key: 'integrated_incidents', name: 'Incidents' })).toBe('Vorfälle');
    expect(knowledgeFolderName(t, { system_key: null, name: 'Requests' })).toBe('Requests');
  });

  it('labels the filter values without changing them', () => {
    expect(knowledgeFolderKeyLabel(t, 'integrated_assets')).toBe('Actifs');
    expect(knowledgeFolderKeyLabel(t, 'Requests')).toBe('Requests');
    expect(knowledgeLibraryKeyLabels(t, [
      { slug: 'managed-docs', name: 'Managed Docs' },
      { slug: 'service-desk-docs', name: 'Service Desk Docs' },
    ])).toEqual({ 'managed-docs': 'Documents managés', 'service-desk-docs': 'Service Desk Docs' });
  });

  it('localizes a folder tree at every depth', () => {
    const tree = localizeKnowledgeFolderTree(t, [
      { id: 'f1', system_key: 'integrated_projects', name: 'Projects', children: [{ id: 'f2', system_key: null, name: 'Archive', children: [] }] },
    ]);
    expect(tree[0].name).toBe('Projets');
    expect(tree[0].children?.[0].name).toBe('Archive');
  });
});
