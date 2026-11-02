# Processus de demande d'accès SAP

L'accès à SAP S/4HANA repose sur des rôles. Toute demande passe par ServiceNow sous **IT > Access > SAP** — les demandes envoyées par e-mail à un membre de l'équipe informatique y sont aimablement redirigées.

## Rôles standard

| Rôle | Périmètre | Approbateur |
|---|---|---|
| SAP FI (Finance) | Écritures comptables, clôture, reporting | Maria Casanova (Finance et contrôle de gestion) |
| SAP MM (Achats) | Commandes d'achat, réceptions de marchandises | Responsable des achats |
| SAP SD (Ventes) | Commandes, livraisons, facturation | Responsable Ventes et marketing |
| SAP PP (Production) | Ordres de fabrication, dossiers de lot | Jacques Dubois (Production) |
| Affichage seul | Accès en lecture à tous les modules | Responsable hiérarchique |

## Chronologie

- Demandes standard : **2 jours ouvrés** après approbation.
- **Circuit accéléré** : pour une clôture mensuelle ou un audit, l'approbateur peut marquer la demande *Urgent — clôture financière*. Les demandes urgentes sont traitées **le jour ouvré même** si elles sont soumises avant 15:00 CET.

## Nouveaux arrivants

Soumettez la demande **avant la date d'arrivée** — l'intégration RH dans Workday crée automatiquement le compte Okta, mais les rôles SAP nécessitent toujours la demande ServiceNow et son approbation. Pour un nouveau contrôleur qui doit passer des écritures dès le premier jour, la demande doit être soumise la semaine précédente, avec l'indicateur *Urgent — clôture financière* si l'arrivée tombe pendant une semaine de clôture.

## Séparation des tâches

Le système bloque les combinaisons contraires aux règles de séparation des tâches (par exemple créer des fournisseurs *et* approuver des paiements). Si votre demande est refusée pour cette raison, Finance et contrôle de gestion arbitre le rôle que vous conservez. Aucune exception — pas même pour une urgence fromagère.
