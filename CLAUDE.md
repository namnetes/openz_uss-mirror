# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Nature du projet

Dépôt de **documentation pure** (MkDocs + Material, en français) : architecture
de résilience CI/CD Mainframe — synchronisation continue des sources GitLab
vers un miroir USS (*Unix System Services*) sur z/OS. Il n'y a **pas de code
applicatif** : `main.py` est un placeholder `uv init`, et le seul module Python
réel est `docs/macros.py` (macros Jinja2 pour mkdocs-macros, actuellement
vide). Pas de tests, pas de cible lint.

Le service décrit n'est **pas encore implémenté** — la documentation est la
conception qui guidera les développements. Les pages non tranchées vont dans
`docs/points-ouverts.md`.

## Commandes

```bash
uv sync            # installer les dépendances (uv exclusivement)
make docs          # serveur local, premier port libre entre 8000 et 8050
make docs-start    # serveur en arrière-plan (PID dans .mkdocs.pid, log .mkdocs.log)
make docs-stop     # arrêter le serveur en arrière-plan
make docs-build    # générer le site statique dans site/
```

`make docs-build` sert de vérification : il échoue sur les erreurs de config
et signale les liens internes cassés dans sa sortie.

## Structure de la documentation

Pas de `nav:` dans `mkdocs.yml` — la navigation est dérivée de l'arborescence
`docs/` (plugin awesome-pages ; aucun fichier `.pages` pour l'instant, ordre
alphabétique par défaut).

- `docs/index.md` — contexte : remplacement de ChangeMan par Git/GitLab,
  enjeu de disponibilité bancaire, le miroir USS comme mode dégradé.
- `docs/architecture/index.md` — page d'entrée de la section (grid cards vers
  `resilience/` et `gestion-incidents.md`).
- `docs/architecture/resilience/` — cœur du sujet : `index.md` (workspaces
  `git worktree`, une branche = un répertoire sous `/u/gitlab/<code appli>/`),
  `service-synchronisation.md`, `detection-defauts.md`,
  `pannes-et-consequences.md`.
- `docs/architecture/gestion-incidents.md` — runbook : panne, vérification
  d'état ISO, resynchronisation.
- `docs/glossaire.md` — vulgarisation des termes ; `docs/perspectives.md` —
  synergies possibles du miroir ; `docs/points-ouverts.md` — questions
  d'architecture non tranchées.

## Architecture technique décrite (fil conducteur inter-pages)

Le mécanisme de synchronisation traverse plusieurs pages ; le comprendre
demande de les recouper :

- Un container **zCX** dédié (le service de sync) réagit aux **webhooks
  GitLab** (`service-synchronisation.md`) et convertit chaque `/` d'un nom de
  branche en `-` pour nommer le workspace (`git worktree add` /
  `fetch && reset --hard` / `git worktree remove`).
- Deux tables **DB2 for z/OS**, accédées via **DRS** : `SYNC_STATUS` (une
  ligne par branche, statut `PENDING`/`READY` = verrou de synchro côté
  consommateur) et `SYNC_SERVICE_HEARTBEAT` (une ligne unique, ping toutes les
  5 min = détection de panne du service, sous ~20 min) — voir
  `detection-defauts.md`.
- Une **réconciliation périodique** compare les hashes de commit GitLab/USS
  et corrige les écarts que ni le heartbeat ni le webhook ne couvrent
  (`detection-defauts.md`, `pannes-et-consequences.md`).
- Le runbook (`gestion-incidents.md`) s'appuie sur ces trois mécanismes :
  fenêtre de grâce des relances webhook GitLab (~3h30), vérification d'état
  ISO, resynchronisation complète.

`docs/points-ouverts.md` recense les questions non tranchées (topologie
active/active du service de sync, sécurisation des webhooks, etc.) ; une
entrée en est retirée dès que la décision migre vers la page définitive
correspondante — ne pas laisser une question résolue dupliquée aux deux
endroits.

## Conventions de rédaction

- **Tout le contenu des pages est en français**, vulgarisé pour un public non
  averti : les sigles sont explicités en italique à la première occurrence
  (ex. `USS (*Unix System Services*)`), les prérequis annoncés en tête de
  page via une admonition `!!! info "Prérequis"`.
- Les pages décrivant des composants non implémentés portent une admonition
  `!!! warning "En cours de spécification"` en tête.
- Style Material déjà en usage : grid cards (`<div class="grid cards"
  markdown>`) sur les pages index, admonitions, Mermaid via
  `pymdownx.superfences`, onglets `pymdownx.tabbed`.
- Vocabulaire métier à respecter : codes application CAPIREF sur deux
  caractères préfixés `DA` (développement LCL) ou `DY` (progiciel), ~600
  dépôts (un par application), USS = miroir réglementaire en lecture seule
  (seul le service de synchronisation écrit). Tout nouveau terme technique
  doit être ajouté au glossaire.
- Les pages se référencent constamment entre elles via des ancres de titre
  (ex. `detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel`).
  Renommer un titre casse ces liens ailleurs dans le dépôt — vérifier avec
  `grep -r "#slug-renomme" docs/` avant de renommer une section, et confirmer
  via `make docs-build` (qui signale les liens internes cassés).

## Configuration MkDocs

- Stack `mkdocsinit` complet (voir `~/.claude/CLAUDE.md` pour la référence) :
  thème Material `language: fr`, `font: false`, macros via
  `docs/macros.py` (`module_name: docs/macros`), CSS pleine largeur dans
  `docs/stylesheets/extra.css`.
- Le plugin `git-revision-date-localized` est commenté dans `mkdocs.yml` ; le
  dépôt ayant maintenant des commits, il peut être décommenté.
