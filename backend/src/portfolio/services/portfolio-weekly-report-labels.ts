/**
 * The words of the weekly report exports (CSV and XLSX) in the four screen languages, as the
 * incident report keeps its own table (`incident-report.service.ts`). The values are the ones
 * the screen shows (`frontend/src/locales/<lang>/portfolio.json`: `reports.weekly.*`,
 * `statuses.*`, `origin.*`, `activity.history.*`, `workspace.task.history.fields.*`), so the
 * file reads like the page. A value missing here falls back to the humanised key.
 */
import type { CsvLanguage } from '../../common/csv-sheet';

export interface WeeklyExportLabels {
  columns: {
    reference: string; requestName: string; projectName: string; taskName: string; taskType: string;
    origin: string; priority: string; source: string; category: string; stream: string; company: string;
    progress: string; status: string; changes: string; createdOn: string; modifiedOn: string; closedOn: string;
    date: string; event: string; team: string; person: string; list: string;
  };
  sheets: { request: string; project: string; task: string };
  lists: { created: string; modified: string; closed: string };
  /** Block titles of the CSV, in list order (created, modified, closed). */
  blocks: { request: [string, string, string]; project: [string, string, string]; task: [string, string, string] };
  tasksByPerson: string;
  noTeam: string;
  unassigned: string;
  statuses: { request: Record<string, string>; project: Record<string, string>; task: Record<string, string> };
  origins: Record<string, string>;
  /** Changed columns of requests and projects, then of tasks, by column name. */
  portfolioFields: Record<string, string>;
  taskFields: Record<string, string>;
  values: { empty: string; unknown: string; yes: string; no: string; itemOne: string; itemOther: string };
  /** The shipped task types by code, as the screen names them (`common.json` `taskTypes.*.label`). */
  taskTypes: Record<string, string>;
  /** Between a changed column's label and its values (`: `, ` : ` in French). */
  labelSeparator: string;
}

export const WEEKLY_EXPORT_LABELS: Record<CsvLanguage, WeeklyExportLabels> = {
  en: {
    "columns": {
      "reference": "Reference",
      "requestName": "Request name",
      "projectName": "Project name",
      "taskName": "Task name",
      "taskType": "Task type",
      "origin": "Origin",
      "priority": "Priority",
      "source": "Source",
      "category": "Category",
      "stream": "Stream",
      "company": "Company",
      "progress": "Effort",
      "status": "Status",
      "changes": "Changes",
      "createdOn": "Created on",
      "modifiedOn": "Modified on",
      "closedOn": "Closed on",
      "date": "Date",
      "event": "Event",
      "team": "Team",
      "person": "Person",
      "list": "List"
    },
    "sheets": {
      "request": "Requests",
      "project": "Projects",
      "task": "Tasks"
    },
    "lists": {
      "created": "Created",
      "modified": "Modified",
      "closed": "Closed"
    },
    "blocks": {
      "request": [
        "Requests created",
        "Requests modified",
        "Requests closed"
      ],
      "project": [
        "Projects created",
        "Projects modified",
        "Projects closed"
      ],
      "task": [
        "Tasks created",
        "Tasks modified",
        "Tasks closed"
      ]
    },
    "tasksByPerson": "Tasks by person",
    "noTeam": "No team",
    "unassigned": "Unassigned",
    "statuses": {
      "request": {
        "pending_review": "Pending review",
        "candidate": "Candidate",
        "approved": "Approved",
        "on_hold": "On hold",
        "rejected": "Rejected",
        "converted": "Converted"
      },
      "project": {
        "waiting_list": "Waiting list",
        "planned": "Planned",
        "in_progress": "In progress",
        "in_testing": "In testing",
        "on_hold": "On hold",
        "done": "Done",
        "cancelled": "Cancelled"
      },
      "task": {
        "open": "Open",
        "in_progress": "In progress",
        "pending": "Pending",
        "in_testing": "In testing",
        "done": "Done",
        "cancelled": "Cancelled"
      }
    },
    "origins": {
      "standard": "Request",
      "fast_track": "Fast-track",
      "legacy": "Legacy"
    },
    "portfolioFields": {
      "name": "Name",
      "purpose": "Purpose",
      "current_situation": "Current situation",
      "expected_benefits": "Expected benefits",
      "risks": "Risks",
      "feasibility_review": "Feasibility review",
      "source_id": "Source",
      "category_id": "Category",
      "stream_id": "Stream",
      "requestor_id": "Requestor",
      "target_delivery_date": "Target delivery date",
      "origin_task_id": "Origin task",
      "origin_task": "Origin task",
      "company_id": "Company",
      "department_id": "Department",
      "business_sponsor_id": "Business sponsor",
      "business_lead_id": "Business lead",
      "it_sponsor_id": "IT sponsor",
      "it_lead_id": "IT lead",
      "planned_start": "Planned start",
      "planned_end": "Planned end",
      "actual_start": "Actual start",
      "actual_end": "Actual end",
      "converted_date": "Converted on",
      "estimated_effort_it": "IT effort",
      "estimated_effort_business": "Business effort",
      "actual_effort_it": "Actual IT effort",
      "actual_effort_business": "Actual business effort",
      "execution_progress": "Effort",
      "priority_score": "Priority score",
      "priority_override": "Priority override",
      "override_value": "Override value",
      "override_justification": "Override justification",
      "criteria_values": "Evaluation criteria",
      "scheduling_mode": "Scheduling mode",
      "it_effort_allocation_mode": "IT effort allocation mode",
      "business_effort_allocation_mode": "Business effort allocation mode"
    },
    "taskFields": {
      "title": "Title",
      "description": "Description",
      "task_type_id": "Task type",
      "priority_level": "Priority",
      "creator_id": "Requestor",
      "assignee_user_id": "Assignee",
      "due_date": "Due date",
      "start_date": "Start date",
      "labels": "Labels",
      "phase_id": "Phase",
      "source_id": "Source",
      "category_id": "Category",
      "stream_id": "Stream",
      "company_id": "Company",
      "owner_ids": "Owners",
      "viewer_ids": "Viewers",
      "related_object_id": "Related to",
      "related_object_type": "Related to"
    },
    "values": {
      "empty": "empty",
      "unknown": "unknown",
      "yes": "Yes",
      "no": "No",
      "itemOne": "{{count}} item",
      "itemOther": "{{count}} items"
    },
    "labelSeparator": ": ",
    "taskTypes": {
      "task": "Task",
      "bug": "Bug",
      "problem": "Problem",
      "incident": "Incident"
    }
  },
  fr: {
    "columns": {
      "reference": "Référence",
      "requestName": "Nom de la demande",
      "projectName": "Nom du projet",
      "taskName": "Nom de la tâche",
      "taskType": "Type de tâche",
      "origin": "Origine",
      "priority": "Priorité",
      "source": "Source",
      "category": "Catégorie",
      "stream": "Filière",
      "company": "Société",
      "progress": "Charge",
      "status": "Statut",
      "changes": "Modifications",
      "createdOn": "Créé le",
      "modifiedOn": "Modifié le",
      "closedOn": "Clôturé le",
      "date": "Date",
      "event": "Événement",
      "team": "Équipe",
      "person": "Personne",
      "list": "Liste"
    },
    "sheets": {
      "request": "Demandes",
      "project": "Projets",
      "task": "Tâches"
    },
    "lists": {
      "created": "Créations",
      "modified": "Modifications",
      "closed": "Clôtures"
    },
    "blocks": {
      "request": [
        "Demandes créées",
        "Demandes modifiées",
        "Demandes clôturées"
      ],
      "project": [
        "Projets créés",
        "Projets modifiés",
        "Projets clôturés"
      ],
      "task": [
        "Tâches créées",
        "Tâches modifiées",
        "Tâches clôturées"
      ]
    },
    "tasksByPerson": "Tâches par personne",
    "noTeam": "Sans équipe",
    "unassigned": "Non affectées",
    "statuses": {
      "request": {
        "pending_review": "En attente de revue",
        "candidate": "Candidat",
        "approved": "Approuvé",
        "on_hold": "Suspendu",
        "rejected": "Rejeté",
        "converted": "Converti"
      },
      "project": {
        "waiting_list": "Liste d'attente",
        "planned": "Planifié",
        "in_progress": "En cours",
        "in_testing": "En test",
        "on_hold": "Suspendu",
        "done": "Terminé",
        "cancelled": "Annulé"
      },
      "task": {
        "open": "Ouvert",
        "in_progress": "En cours",
        "pending": "En attente",
        "in_testing": "En test",
        "done": "Terminé",
        "cancelled": "Annulé"
      }
    },
    "origins": {
      "standard": "Demande",
      "fast_track": "Fast-track",
      "legacy": "Historique"
    },
    "portfolioFields": {
      "name": "Nom",
      "purpose": "Objectif",
      "current_situation": "Situation actuelle",
      "expected_benefits": "Bénéfices attendus",
      "risks": "Risques",
      "feasibility_review": "Revue de faisabilité",
      "source_id": "Source",
      "category_id": "Catégorie",
      "stream_id": "Filière",
      "requestor_id": "Demandeur",
      "target_delivery_date": "Date de livraison cible",
      "origin_task_id": "Tâche d'origine",
      "origin_task": "Tâche d'origine",
      "company_id": "Société",
      "department_id": "Département",
      "business_sponsor_id": "Sponsor métier",
      "business_lead_id": "Responsable métier",
      "it_sponsor_id": "Sponsor IT",
      "it_lead_id": "Responsable IT",
      "planned_start": "Début prévu",
      "planned_end": "Fin prévue",
      "actual_start": "Début réel",
      "actual_end": "Fin réelle",
      "converted_date": "Converti le",
      "estimated_effort_it": "Charge IT",
      "estimated_effort_business": "Charge métier",
      "actual_effort_it": "Charge IT réelle",
      "actual_effort_business": "Charge métier réelle",
      "execution_progress": "Charge",
      "priority_score": "Score de priorité",
      "priority_override": "Surcharge de priorité",
      "override_value": "Valeur de surcharge",
      "override_justification": "Justification de la surcharge",
      "criteria_values": "Critères d'évaluation",
      "scheduling_mode": "Mode de planification",
      "it_effort_allocation_mode": "Mode de ventilation de la charge IT",
      "business_effort_allocation_mode": "Mode de ventilation de la charge métier"
    },
    "taskFields": {
      "title": "Titre",
      "description": "Description",
      "task_type_id": "Type de tâche",
      "priority_level": "Priorité",
      "creator_id": "Demandeur",
      "assignee_user_id": "Assigné à",
      "due_date": "Échéance",
      "start_date": "Date de début",
      "labels": "Étiquettes",
      "phase_id": "Phase",
      "source_id": "Source",
      "category_id": "Catégorie",
      "stream_id": "Filière",
      "company_id": "Société",
      "owner_ids": "Responsables",
      "viewer_ids": "Observateurs",
      "related_object_id": "Lié à",
      "related_object_type": "Lié à"
    },
    "values": {
      "empty": "vide",
      "unknown": "inconnu",
      "yes": "Oui",
      "no": "Non",
      "itemOne": "{{count}} élément",
      "itemOther": "{{count}} éléments"
    },
    "labelSeparator": " : ",
    "taskTypes": {
      "task": "Tâche",
      "bug": "Bug",
      "problem": "Problème",
      "incident": "Incident"
    }
  },
  de: {
    "columns": {
      "reference": "Referenz",
      "requestName": "Anfragenname",
      "projectName": "Projektname",
      "taskName": "Aufgabenname",
      "taskType": "Aufgabentyp",
      "origin": "Herkunft",
      "priority": "Priorität",
      "source": "Quelle",
      "category": "Kategorie",
      "stream": "Stream",
      "company": "Unternehmen",
      "progress": "Aufwand",
      "status": "Status",
      "changes": "Änderungen",
      "createdOn": "Erstellt am",
      "modifiedOn": "Geändert am",
      "closedOn": "Geschlossen am",
      "date": "Datum",
      "event": "Ereignis",
      "team": "Team",
      "person": "Person",
      "list": "Liste"
    },
    "sheets": {
      "request": "Anfragen",
      "project": "Projekte",
      "task": "Aufgaben"
    },
    "lists": {
      "created": "Erstellt",
      "modified": "Geändert",
      "closed": "Geschlossen"
    },
    "blocks": {
      "request": [
        "Erstellte Anfragen",
        "Geänderte Anfragen",
        "Geschlossene Anfragen"
      ],
      "project": [
        "Erstellte Projekte",
        "Geänderte Projekte",
        "Geschlossene Projekte"
      ],
      "task": [
        "Erstellte Aufgaben",
        "Geänderte Aufgaben",
        "Geschlossene Aufgaben"
      ]
    },
    "tasksByPerson": "Aufgaben nach Person",
    "noTeam": "Ohne Team",
    "unassigned": "Nicht zugewiesen",
    "statuses": {
      "request": {
        "pending_review": "Prüfung ausstehend",
        "candidate": "Kandidat",
        "approved": "Genehmigt",
        "on_hold": "Pausiert",
        "rejected": "Abgelehnt",
        "converted": "Konvertiert"
      },
      "project": {
        "waiting_list": "Warteliste",
        "planned": "Geplant",
        "in_progress": "In Bearbeitung",
        "in_testing": "Im Test",
        "on_hold": "Pausiert",
        "done": "Erledigt",
        "cancelled": "Abgebrochen"
      },
      "task": {
        "open": "Offen",
        "in_progress": "In Bearbeitung",
        "pending": "Ausstehend",
        "in_testing": "Im Test",
        "done": "Erledigt",
        "cancelled": "Abgebrochen"
      }
    },
    "origins": {
      "standard": "Anfrage",
      "fast_track": "Fast-track",
      "legacy": "Altbestand"
    },
    "portfolioFields": {
      "name": "Name",
      "purpose": "Zweck",
      "current_situation": "Aktuelle Situation",
      "expected_benefits": "Erwarteter Nutzen",
      "risks": "Risiken",
      "feasibility_review": "Machbarkeitsprüfung",
      "source_id": "Quelle",
      "category_id": "Kategorie",
      "stream_id": "Stream",
      "requestor_id": "Antragsteller",
      "target_delivery_date": "Ziellieferdatum",
      "origin_task_id": "Ursprungsaufgabe",
      "origin_task": "Ursprungsaufgabe",
      "company_id": "Unternehmen",
      "department_id": "Abteilung",
      "business_sponsor_id": "Fachbereichssponsor",
      "business_lead_id": "Fachbereichsleiter",
      "it_sponsor_id": "IT-Sponsor",
      "it_lead_id": "IT-Leiter",
      "planned_start": "Geplanter Start",
      "planned_end": "Geplantes Ende",
      "actual_start": "Tatsächlicher Beginn",
      "actual_end": "Tatsächliches Ende",
      "converted_date": "Umgewandelt am",
      "estimated_effort_it": "IT-Aufwand",
      "estimated_effort_business": "Fachbereichs-Aufwand",
      "actual_effort_it": "Tatsächlicher IT-Aufwand",
      "actual_effort_business": "Tatsächlicher Fachbereichs-Aufwand",
      "execution_progress": "Aufwand",
      "priority_score": "Prioritätsscore",
      "priority_override": "Prioritätsüberschreibung",
      "override_value": "Überschreibungswert",
      "override_justification": "Begründung der Überschreibung",
      "criteria_values": "Bewertungskriterien",
      "scheduling_mode": "Planungsmodus",
      "it_effort_allocation_mode": "Zuordnungsmodus IT-Aufwand",
      "business_effort_allocation_mode": "Zuordnungsmodus Fachbereichs-Aufwand"
    },
    "taskFields": {
      "title": "Titel",
      "description": "Beschreibung",
      "task_type_id": "Aufgabentyp",
      "priority_level": "Priorität",
      "creator_id": "Antragsteller",
      "assignee_user_id": "Zuständig",
      "due_date": "Fälligkeitsdatum",
      "start_date": "Startdatum",
      "labels": "Labels",
      "phase_id": "Phase",
      "source_id": "Quelle",
      "category_id": "Kategorie",
      "stream_id": "Stream",
      "company_id": "Unternehmen",
      "owner_ids": "Verantwortliche",
      "viewer_ids": "Beobachter",
      "related_object_id": "Verknüpft mit",
      "related_object_type": "Verknüpft mit"
    },
    "values": {
      "empty": "leer",
      "unknown": "unbekannt",
      "yes": "Ja",
      "no": "Nein",
      "itemOne": "{{count}} Element",
      "itemOther": "{{count}} Elemente"
    },
    "labelSeparator": ": ",
    "taskTypes": {
      "task": "Aufgabe",
      "bug": "Bug",
      "problem": "Problem",
      "incident": "Vorfall"
    }
  },
  es: {
    "columns": {
      "reference": "Referencia",
      "requestName": "Nombre de la solicitud",
      "projectName": "Nombre del proyecto",
      "taskName": "Nombre de la tarea",
      "taskType": "Tipo de tarea",
      "origin": "Procedencia",
      "priority": "Prioridad",
      "source": "Origen",
      "category": "Categoría",
      "stream": "Línea",
      "company": "Empresa",
      "progress": "Esfuerzo",
      "status": "Estado",
      "changes": "Cambios",
      "createdOn": "Creado el",
      "modifiedOn": "Modificado el",
      "closedOn": "Cerrado el",
      "date": "Fecha",
      "event": "Evento",
      "team": "Equipo",
      "person": "Persona",
      "list": "Lista"
    },
    "sheets": {
      "request": "Solicitudes",
      "project": "Proyectos",
      "task": "Tareas"
    },
    "lists": {
      "created": "Creaciones",
      "modified": "Modificaciones",
      "closed": "Cierres"
    },
    "blocks": {
      "request": [
        "Solicitudes creadas",
        "Solicitudes modificadas",
        "Solicitudes cerradas"
      ],
      "project": [
        "Proyectos creados",
        "Proyectos modificados",
        "Proyectos cerrados"
      ],
      "task": [
        "Tareas creadas",
        "Tareas modificadas",
        "Tareas cerradas"
      ]
    },
    "tasksByPerson": "Tareas por persona",
    "noTeam": "Sin equipo",
    "unassigned": "Sin asignar",
    "statuses": {
      "request": {
        "pending_review": "Pendiente de revisión",
        "candidate": "Candidata",
        "approved": "Aprobada",
        "on_hold": "En pausa",
        "rejected": "Rechazada",
        "converted": "Convertida"
      },
      "project": {
        "waiting_list": "Lista de espera",
        "planned": "Planificado",
        "in_progress": "En curso",
        "in_testing": "En pruebas",
        "on_hold": "En pausa",
        "done": "Completado",
        "cancelled": "Cancelado"
      },
      "task": {
        "open": "Abierta",
        "in_progress": "En curso",
        "pending": "Pendiente",
        "in_testing": "En pruebas",
        "done": "Completada",
        "cancelled": "Cancelada"
      }
    },
    "origins": {
      "standard": "Solicitud",
      "fast_track": "Fast-track",
      "legacy": "Histórico"
    },
    "portfolioFields": {
      "name": "Nombre",
      "purpose": "Objetivo",
      "current_situation": "Situación actual",
      "expected_benefits": "Beneficios esperados",
      "risks": "Riesgos",
      "feasibility_review": "Revisión de viabilidad",
      "source_id": "Origen",
      "category_id": "Categoría",
      "stream_id": "Línea",
      "requestor_id": "Solicitante",
      "target_delivery_date": "Fecha de entrega objetivo",
      "origin_task_id": "Tarea de origen",
      "origin_task": "Tarea de origen",
      "company_id": "Empresa",
      "department_id": "Departamento",
      "business_sponsor_id": "Patrocinador de negocio",
      "business_lead_id": "Responsable de negocio",
      "it_sponsor_id": "Patrocinador IT",
      "it_lead_id": "Responsable IT",
      "planned_start": "Inicio planificado",
      "planned_end": "Fin planificado",
      "actual_start": "Inicio real",
      "actual_end": "Fin real",
      "converted_date": "Convertido el",
      "estimated_effort_it": "Esfuerzo IT",
      "estimated_effort_business": "Esfuerzo de negocio",
      "actual_effort_it": "Esfuerzo IT real",
      "actual_effort_business": "Esfuerzo de negocio real",
      "execution_progress": "Esfuerzo",
      "priority_score": "Puntuación de prioridad",
      "priority_override": "Sobrescritura de prioridad",
      "override_value": "Valor de sobrescritura",
      "override_justification": "Justificación de la sobrescritura",
      "criteria_values": "Criterios de evaluación",
      "scheduling_mode": "Modo de planificación",
      "it_effort_allocation_mode": "Modo de asignación de esfuerzo IT",
      "business_effort_allocation_mode": "Modo de asignación de esfuerzo de negocio"
    },
    "taskFields": {
      "title": "Título",
      "description": "Descripción",
      "task_type_id": "Tipo de tarea",
      "priority_level": "Prioridad",
      "creator_id": "Solicitante",
      "assignee_user_id": "Asignado a",
      "due_date": "Fecha de vencimiento",
      "start_date": "Fecha de inicio",
      "labels": "Etiquetas",
      "phase_id": "Fase",
      "source_id": "Origen",
      "category_id": "Categoría",
      "stream_id": "Línea",
      "company_id": "Empresa",
      "owner_ids": "Responsables",
      "viewer_ids": "Observadores",
      "related_object_id": "Relacionado con",
      "related_object_type": "Relacionado con"
    },
    "values": {
      "empty": "vacío",
      "unknown": "desconocido",
      "yes": "Sí",
      "no": "No",
      "itemOne": "{{count}} elemento",
      "itemOther": "{{count}} elementos"
    },
    "labelSeparator": ": ",
    "taskTypes": {
      "task": "Tarea",
      "bug": "Bug",
      "problem": "Problema",
      "incident": "Incidente"
    }
  },
};
