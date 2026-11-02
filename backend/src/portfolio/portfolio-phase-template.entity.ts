import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export interface PhaseTemplateItemData {
  id?: string;
  name: string;
  sequence: number;
  has_milestone: boolean;
  milestone_name: string | null;
}

/** A shipped name in the four seed languages. */
export type PhaseTemplateText = Record<'en' | 'fr' | 'de' | 'es', string>;

const GO_LIVE: PhaseTemplateText = { en: 'Go-live', fr: 'Mise en production', de: 'Go-live', es: 'Puesta en producción' };
const PROJECT_COMPLETE: PhaseTemplateText = { en: 'Project Complete', fr: 'Projet terminé', de: 'Projekt abgeschlossen', es: 'Proyecto completado' };
const DEPLOYMENT_SUCCESSFUL: PhaseTemplateText = { en: 'Deployment Successful', fr: 'Déploiement réussi', de: 'Rollout erfolgreich', es: 'Despliegue exitoso' };
const DOCUMENTATION: PhaseTemplateText = {
  en: 'Documentation & Competence Transfer',
  fr: 'Documentation et transfert de compétences',
  de: 'Dokumentation und Wissenstransfer',
  es: 'Documentación y transferencia de conocimiento',
};

/**
 * The phase templates a workspace starts with (seeded on the first read of the list,
 * `PortfolioPhaseTemplatesService.seedDefaults`), named in the workspace seed language.
 */
export const DEFAULT_PHASE_TEMPLATES: ReadonlyArray<{
  name: PhaseTemplateText;
  items: ReadonlyArray<{ name: PhaseTemplateText; has_milestone: boolean; milestone_name: PhaseTemplateText }>;
}> = [
  {
    name: { en: 'Mini Project', fr: 'Mini-projet', de: 'Kleinprojekt', es: 'Miniproyecto' },
    items: [
      { name: { en: 'Realization', fr: 'Réalisation', de: 'Umsetzung', es: 'Realización' }, has_milestone: true, milestone_name: GO_LIVE },
      { name: DOCUMENTATION, has_milestone: true, milestone_name: PROJECT_COMPLETE },
    ],
  },
  {
    name: { en: 'Business Apps', fr: 'Applications métier', de: 'Geschäftsanwendungen', es: 'Aplicaciones de negocio' },
    items: [
      {
        name: { en: 'Requirement Analysis & Specifications', fr: 'Analyse des besoins et spécifications', de: 'Anforderungsanalyse und Spezifikation', es: 'Análisis de requisitos y especificaciones' },
        has_milestone: true,
        milestone_name: { en: 'Specs Ready', fr: 'Spécifications prêtes', de: 'Spezifikation fertig', es: 'Especificaciones listas' },
      },
      {
        name: { en: 'Realization / Development / Unit Testing', fr: 'Réalisation / développement / tests unitaires', de: 'Umsetzung / Entwicklung / Modultests', es: 'Realización / desarrollo / pruebas unitarias' },
        has_milestone: true,
        milestone_name: { en: 'Ready for UAT', fr: 'Prêt pour la recette', de: 'Bereit für den Abnahmetest', es: 'Listo para las pruebas de aceptación' },
      },
      {
        name: { en: 'User Acceptance Testing', fr: 'Recette utilisateur', de: 'Abnahmetest', es: 'Pruebas de aceptación de usuario' },
        has_milestone: true,
        milestone_name: { en: 'Ready for Deployment', fr: 'Prêt pour le déploiement', de: 'Bereit für den Rollout', es: 'Listo para el despliegue' },
      },
      {
        name: { en: 'Go-live & Hypercare', fr: 'Mise en production et hypercare', de: 'Go-live und Hypercare', es: 'Puesta en producción e hypercare' },
        has_milestone: true,
        milestone_name: DEPLOYMENT_SUCCESSFUL,
      },
      { name: DOCUMENTATION, has_milestone: true, milestone_name: PROJECT_COMPLETE },
    ],
  },
  {
    name: { en: 'IT Project', fr: 'Projet informatique', de: 'IT-Projekt', es: 'Proyecto de TI' },
    items: [
      {
        name: { en: 'Requirements Analysis & Solution Selection', fr: 'Analyse des besoins et choix de la solution', de: 'Anforderungsanalyse und Lösungsauswahl', es: 'Análisis de requisitos y selección de la solución' },
        has_milestone: true,
        milestone_name: { en: 'Ready for Implementation', fr: 'Prêt pour la mise en œuvre', de: 'Bereit für die Implementierung', es: 'Listo para la implementación' },
      },
      {
        name: { en: 'Implementation', fr: 'Mise en œuvre', de: 'Implementierung', es: 'Implementación' },
        has_milestone: true,
        milestone_name: { en: 'Ready for Production', fr: 'Prêt pour la production', de: 'Bereit für die Produktion', es: 'Listo para producción' },
      },
      {
        name: { en: 'Deployment & Hypercare', fr: 'Déploiement et hypercare', de: 'Rollout und Hypercare', es: 'Despliegue e hypercare' },
        has_milestone: true,
        milestone_name: DEPLOYMENT_SUCCESSFUL,
      },
      { name: DOCUMENTATION, has_milestone: true, milestone_name: PROJECT_COMPLETE },
    ],
  },
];

@Entity('portfolio_phase_templates')
@Index(['tenant_id', 'name'], { unique: true })
@Index(['tenant_id', 'sequence'])
export class PortfolioPhaseTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('text')
  name!: string;

  @Column('boolean', { default: false })
  is_system!: boolean;

  @Column('int', { default: 0 })
  sequence!: number;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}
