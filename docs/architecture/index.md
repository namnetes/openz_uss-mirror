# Architecture

Cette section décrit les composants techniques prévus pour assurer la
résilience de la chaîne CI/CD (*Continuous Integration / Continuous
Delivery*) du Mainframe — c'est-à-dire sa capacité à continuer de fonctionner
même en cas de panne d'un outil externe comme GitLab.

<div class="grid cards" markdown>

-   :material-sync: **[Résilience et synchronisation USS](resilience/index.md)**

    Comment les sources GitLab sont maintenues à l'identique sur le miroir
    USS (*Unix System Services*) — synchronisation, mode dégradé et
    supervision.

-   :material-lifebuoy: **[Gestion des incidents et reprise](gestion-incidents.md)**

    Le [runbook](../glossaire.md#runbook) : que se passe-t-il pendant une panne,
    comment vérifier que USS est à jour ([état ISO](../glossaire.md#iso-etat)),
    comment resynchroniser après incident.

</div>

## Périmètre du projet et responsabilités

Pour éviter que chaque page ne redéfinisse implicitement cette frontière, elle est posée une fois ici.

### Infrastructure z/OS — à la charge de l'exploitant {: #infrastructure-z-os-a-la-charge-de-lexploitant }

L'[exploitant](../glossaire.md#exploitant) administre le z/OS au global : LPAR, réseau inter-datacenters, moteur DB2 lui-même (disponibilité, RTO/RPO propres à DB2). Il dispose de ses propres procédures d'alerte et de notification, et valide régulièrement cette infrastructure par des exercices [PSI](../glossaire.md#psi-plan-de-secours-informatique) (*Plan de Secours Informatique*).

Ce projet **subit** les conséquences d'une indisponibilité de cette infrastructure (voir par exemple [DB2 ou DRS indisponible alors que zCX fonctionne](resilience/pannes-et-consequences.md#db2-ou-drs-indisponible-alors-que-zcx-fonctionne)) mais n'a ni à la superviser, ni à en garantir la haute disponibilité, ni à engager un RTO/RPO qui ne lui appartient pas. Le RTO/RPO encore à formaliser (voir [Points non couverts](../points-ouverts.md#fiabilite-du-dispositif-de-mitigation-constats-de-lanalyse-technique)) porte uniquement sur le **service de synchronisation lui-même** — sa capacité à détecter une panne et à revenir à un état sain une fois l'infrastructure disponible — jamais sur le temps de bascule de la LPAR, du réseau ou de DB2.

### Accès en lecture des consommateurs — à la charge des consommateurs {: #acces-en-lecture-des-consommateurs }

Les équipes qui consomment le miroir USS (pipelines de build, outils de packaging, archivage, recompilation de masse...) gèrent elles-mêmes leurs propres habilitations de lecture. Ce projet ne gère à aucun titre les droits d'accès de ses consommateurs.

Ce qu'il **doit** fournir en contrepartie, ce sont des services permettant à ces consommateurs de vérifier, avant de lire un workspace, que le miroir est :

- **synchro** (à jour par rapport à GitLab) — couvert par le statut `PENDING`/`READY` de `SYNC_STATUS`, voir [Vérification côté consommateur](resilience/detection-defauts.md#verification-cote-consommateur-verrou-de-synchro) ;
- **propre** (contenu intègre) — **non couvert aujourd'hui** par un service à la demande : seule la réconciliation périodique compare les hashes, à sa cadence, pas à l'appel d'un consommateur précis — voir [Points non couverts](../points-ouverts.md#service-de-verification-de-lintegrite-proprete-du-miroir-a-la-demande).

### Ce qui reste de la responsabilité de ce projet {: #ce-qui-reste-de-la-responsabilite-de-ce-projet }

Le service de synchronisation lui-même (webhooks, cycle de vie d'une branche, heartbeat, réconciliation), le verrou de synchro déjà exposé aux consommateurs, et — à concevoir — le service de vérification d'intégrité qui manque encore aujourd'hui.
