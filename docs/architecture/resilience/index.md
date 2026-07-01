# Résilience et synchronisation USS

!!! warning "En cours de spécification"
    Cette page décrit l'architecture de résilience prévue. Le service de synchronisation n'est pas encore implémenté — cette conception guide les développements à venir.

!!! info "Prérequis"
    Cette page suppose une familiarité de base avec Git (branche, commit, hash) et avec le concept de *package* (unité de livraison versionnée). Elle s'appuie aussi sur le rôle de DB2 for z/OS, la base de données utilisée pour la traçabilité de la plateforme.

## La contrainte de départ

La plateforme repose sur GitLab, une infrastructure ouverte hébergée hors du z/OS. Sur un SI (*Système d'Information*) critique bancaire, toute dépendance à une infrastructure externe représente un risque réglementaire : une panne GitLab ne peut pas priver le périmètre z/OS natif de l'accès aux sources.

**La règle est donc absolue : à tout instant, les sources sur USS (*Unix System Services*) sont identiques aux sources sur GitLab.**

USS n'est pas un cache de travail. C'est un **miroir réglementaire** : une copie certifiable et vérifiable du référentiel GitLab, hébergée dans le périmètre z/OS natif.

**USS est strictement accessible en lecture pour tout le monde, y compris en mode dégradé.** Seul le service de synchronisation est autorisé à écrire sur les workspaces USS (création, mise à jour, suppression de worktrees) ; aucun développeur, opérateur ou processus manuel n'y écrit directement, sous peine de rompre la garantie d'identité avec GitLab que ce miroir existe pour certifier.

## Les workspaces USS — une branche, un répertoire

Le patrimoine applicatif compte environ **600 dépôts**, un par application du SI, chacun référencé dans la cartographie d'entreprise **CAPIREF** sous un code application unique sur deux caractères alphanumériques, préfixé `DA` (développement propriétaire LCL) ou `DY` (progiciel) — par exemple `DA12` ou `DY07`. Le mécanisme décrit dans cette section se répète à l'identique pour chacun de ces 600 dépôts, indépendamment les uns des autres.

Pour un dépôt donné, USS ne maintient pas une seule copie de `main`. Chaque branche active dispose de son propre répertoire de travail, créé dès la création de la branche dans GitLab.

La solution technique retenue est **`git worktree`** : plusieurs branches coexistent simultanément sur USS depuis un seul dépôt git, en partageant les objets git communs. Seuls les fichiers propres à chaque branche occupent de l'espace supplémentaire.

```
/u/gitlab/
  DA12/                               ← application DA12 (code CAPIREF)
    repo/                             ← dépôt git principal (objets partagés)
    workspaces/
      main/                           ← branche main (référence)
      pkg-PKG-20260616-0042/          ← workspace du package 0042
      pkg-PKG-20260617-0001/          ← workspace du package 0001
  DY07/                               ← application DY07 (autre code CAPIREF)
    repo/
    workspaces/
      main/
      pkg-PKG-20260617-0003/          ← workspace du package 0003
```

Quand un développeur ne modifie que 3 fichiers sur sa branche, son workspace ne coûte que ces 3 fichiers en espace disque par rapport à `main` — le reste est partagé.

<div class="grid cards" markdown>

-   :material-cog-sync: **[Le service de synchronisation](service-synchronisation.md)**

    Le mécanisme lui-même : webhooks GitLab, cycle de vie d'une branche, amorçage et idempotence.

-   :material-heart-pulse: **[Détection et gestion des défauts de synchro](detection-defauts.md)**

    Heartbeat DB2, réconciliation périodique, vérification côté consommateur (verrou de synchro).

-   :material-alert-decagram: **[Catalogue des pannes et conséquences](pannes-et-consequences.md)**

    Panne GitLab, panne zCX, panne DB2/DRS, panne z/OS, bug ciblé — ce que chacune bloque réellement, et comment on en sort.

</div>

## Impact sur l'architecture globale

Ce composant modifie la vue d'ensemble de la plateforme sur quatre points :

1. **Un nouveau container zCX** est ajouté : le service de sync, dédié à la réception des webhooks et à la gestion des worktrees USS. Il est intentionnellement séparé du container applicatif (NiceGUI + FastAPI) pour que sa panne n'affecte pas l'interface, et réciproquement.

2. **USS devient une couche d'infrastructure à part entière**, et non un simple répertoire de travail temporaire. Sa disponibilité, son espace disque et la santé de ses worktrees doivent être surveillées au même titre que les autres composants critiques de la plateforme.

3. **DB2 for z/OS gagne deux tables supplémentaires** (`SYNC_STATUS` et `SYNC_SERVICE_HEARTBEAT`), sans nouvelle brique d'infrastructure : une extension du registre central déjà utilisé pour la traçabilité des packages. `SYNC_STATUS` accélère la réconciliation périodique et expose aux consommateurs un statut `PENDING`/`READY` pour éviter toute lecture partielle d'un workspace en cours de synchro ; `SYNC_SERVICE_HEARTBEAT` porte le signal de vie du service, indépendamment de toute activité GitLab (voir [Détection et gestion des défauts de synchro](detection-defauts.md)).

4. **La résilience de ce composant s'appuie sur l'infrastructure existante** : le SI bancaire est hébergé sur deux datacenters en haute disponibilité, ce qui couvre nativement la panne physique (stockage, LPAR — *Logical Partition*) ainsi que la disponibilité de DB2 — sans dispositif spécifique à concevoir pour ce projet sur ce point. Seule la topologie du service de sync lui-même entre les deux sites (actif/actif ou actif/passif) reste à préciser, voir [Points non couverts](../../points-ouverts.md#topologie-du-service-de-sync-entre-les-deux-datacenters).

USS étant maintenu à l'identique de GitLab par ce mécanisme, c'est cette garantie qui permet un **mode dégradé** en cas de panne GitLab : compiler, promouvoir et déployer directement depuis le dernier état synchronisé.

---

Pour la suite opérationnelle — que se passe-t-il pendant une panne, comment vérifier que USS est à jour, comment resynchroniser après incident — voir [Gestion des incidents et reprise](../gestion-incidents.md).

Pour le contexte stratégique plus large — comment ce miroir pourrait servir d'autres projets et obligations réglementaires — voir [Perspectives et synergies](../../perspectives.md).
