# Glossaire

!!! info "Public visé"
    Ce glossaire vulgarise les termes techniques utilisés dans le reste de la documentation, pour un lecteur qui ne connaît ni Git, ni le Mainframe, ni la plateforme bancaire. Les définitions privilégient l'intuition plutôt que l'exactitude technique complète — pour le détail précis, voir la page concernée.

## A

**API REST**
Un moyen standardisé pour deux logiciels de se parler à travers le réseau, en s'échangeant de courts messages structurés (souvent au format JSON). GitLab expose ainsi une API REST qui permet d'interroger ou de piloter un dépôt sans passer par l'interface web.

**Application (code CAPIREF)**
Dans la cartographie d'entreprise, chaque application du système d'information est identifiée par un code unique sur 4 caractères : `DA` (développement propriétaire, c'est-à-dire écrit en interne) ou `DY` (progiciel, c'est-à-dire un logiciel acheté à un éditeur), suivi de deux caractères alphanumériques — par exemple `DA12` ou `DY07`.

## B

**Bijection (source ↔ load)**
Le fait de pouvoir établir, sans ambiguïté et dans les deux sens, quel code source a produit quel binaire de production, et inversement. C'est une exigence d'audit : on doit pouvoir remonter du binaire qui tourne en production jusqu'au code exact qui l'a généré.

**Branche (Git)**
Une ligne de développement indépendante au sein d'un même projet — par exemple, une branche par correctif ou par nouvelle fonctionnalité, qui n'affecte pas le code des autres branches tant qu'elle n'est pas fusionnée.

## C

**CI/CD**
*Continuous Integration / Continuous Delivery* — l'ensemble des étapes automatisées qui transforment un code source en un programme testé, packagé et prêt à être déployé en production (compilation, tests, packaging, promotion).

**Commit (Git)**
Un instantané enregistré du code à un moment donné, avec un message expliquant ce qui a changé. Chaque commit possède un identifiant unique (le *hash*, voir plus bas).

**Container**
Un environnement logiciel isolé et léger, qui embarque une application et tout ce dont elle a besoin pour fonctionner, sans dépendre du reste du système qui l'héberge.

## D

**DB2 for z/OS**
La base de données utilisée par la plateforme Mainframe pour stocker de façon fiable des informations de suivi (par exemple : quel commit est actuellement synchronisé sur quelle branche).

**DRS (Db2 REST Services)**
Le composant qui permet à un programme d'interroger ou de mettre à jour DB2 via de simples appels API REST, sans avoir à parler le langage natif de la base de données.

**DORA**
*Digital Operational Resilience Act* — un règlement européen qui impose aux établissements financiers de pouvoir continuer à fonctionner, ou se reconstruire rapidement, en cas d'incident informatique majeur (panne, cyberattaque).

## G

**Git**
Un outil qui permet de suivre l'historique des modifications d'un code source : qui a changé quoi, quand, et de revenir en arrière si besoin. C'est la brique de base sur laquelle GitLab est construit.

**GitLab**
Une plateforme web qui héberge les dépôts Git de l'entreprise et automatise les étapes de CI/CD (construction, tests, déploiement) à partir de ce code source.

## H

**Hash (de commit)**
Une suite de caractères qui identifie de façon unique un état précis du code. Deux copies identiques du même code produisent toujours le même hash — c'est ce qui permet de vérifier que deux endroits (par exemple GitLab et USS) contiennent exactement la même chose, sans comparer fichier par fichier.

**Heartbeat**
Un signal envoyé à intervalle régulier pour prouver qu'un service est toujours actif. Si le signal s'arrête, c'est le signe que quelque chose ne fonctionne plus, même sans message d'erreur explicite.

## I

**Idempotent**
Une opération est dite idempotente quand la répéter plusieurs fois produit toujours le même résultat que l'exécuter une seule fois — sans effet de bord supplémentaire. Par exemple, traiter deux fois le même événement de push ne crée pas deux workspaces, ni n'applique deux fois le même changement.

**IG (Inspection Générale)**
La fonction d'audit interne de l'établissement, chargée de vérifier que les règles de contrôle et de gestion des risques sont bien respectées. Certaines de ses recommandations (comme l'exigence de bijection source/binaire) s'imposent aux projets informatiques.

**ISO (état)**
Dans cette documentation, ne désigne pas la norme ISO mais le sens littéral d'"identique" : un workspace USS est dit "ISO" lorsqu'il contient exactement le même code que la branche GitLab correspondante.

## L

**LPAR**
*Logical Partition* — une partition logique d'un Mainframe, qui se comporte comme une machine indépendante tout en partageant le matériel physique avec d'autres partitions.

**Load module**
Le programme compilé, prêt à être exécuté, obtenu après compilation et édition de liens du code source. C'est ce binaire qui tourne réellement en production — voir aussi *VLM*.

## M

**Mainframe**
Un ordinateur central de très grande capacité, utilisé dans les environnements bancaires pour sa fiabilité et sa puissance de traitement. Le système d'exploitation utilisé ici est z/OS (voir plus bas).

**Mia Discovery**
Le logiciel de cartographie applicative du patrimoine — il dresse l'inventaire des applications et de leurs composants, indépendamment de ce projet de miroir USS.

**Mirroir**
Une copie d'un ensemble de données, maintenue à jour en continu et destinée à rester strictement identique à l'original — ici, à but de continuité d'activité et de preuve d'audit, et non de travail quotidien.

**Mode dégradé**
Un mode de fonctionnement temporaire, activé quand un système habituel (ici GitLab) est indisponible, qui permet de continuer les opérations essentielles via des procédures de secours, en attendant le retour à la normale.

## P

**Package**
Une unité de livraison versionnée — l'ensemble cohérent de changements de code regroupés pour être construits, testés et déployés ensemble, identifié par un numéro unique.

**PassTicket**
Un mécanisme de sécurité Mainframe qui permet à un programme de prouver son identité auprès d'un autre composant interne (par exemple DB2) sans avoir à stocker ou transmettre un mot de passe en clair, en utilisant un secret partagé à usage unique.

## R

**RACF**
Le système de sécurité du Mainframe qui gère les identités, les habilitations et les autorisations d'accès — l'équivalent, pour le Mainframe, d'un système de gestion des comptes et des droits.

**Réconciliation**
Une vérification périodique qui compare l'état réellement enregistré (par exemple sur USS) avec une source de référence (GitLab), pour détecter et corriger automatiquement les écarts.

## S

**Synchronisation**
Le mécanisme qui maintient deux emplacements (ici GitLab et USS) constamment alignés : chaque changement effectué d'un côté est répercuté de l'autre côté, sans intervention humaine.

## U

**USS (Unix System Services)**
Un environnement compatible Unix qui tourne au sein de z/OS, permettant d'utiliser des outils standards (comme Git) directement sur le Mainframe.

## V

**VLM (View Load Module)**
Le terme utilisé en interne pour désigner le binaire compilé déployé en production — synonyme de *load module* dans ce contexte. C'est aussi le nom d'une fonctionnalité du logiciel **File Manager** (IBM), qui permet de visualiser le contenu d'un load module.

## W

**Webhook**
Une notification automatique envoyée par un service (ici GitLab) vers un autre dès qu'un événement se produit (un nouveau commit, une branche créée ou supprimée) — l'inverse d'une vérification périodique : c'est le service qui prévient, plutôt que d'être interrogé.

**Workspace**
Un répertoire de travail dédié à une branche donnée, contenant son code source à jour. Dans ce projet, chaque branche active dispose de son propre workspace sur USS.

**Worktree (`git worktree`)**
Une fonctionnalité de Git qui permet d'avoir plusieurs répertoires de travail (un par branche) issus du même dépôt, sans dupliquer l'historique complet pour chacun — seuls les fichiers propres à chaque branche occupent de l'espace disque supplémentaire.

## Z

**z/OS**
Le système d'exploitation du Mainframe IBM utilisé par la plateforme bancaire.

**zCX (z/OS Container Extensions)**
La technologie qui permet de faire tourner des containers Linux directement sur z/OS, sans machine séparée — c'est l'environnement dans lequel s'exécute le service de synchronisation USS.

**z/OS Container Platform (zCP)**
Une évolution plus récente de zCX, basée sur Kubernetes : elle permet d'orchestrer plusieurs containers sur z/OS (répartition de charge, redémarrage automatique, mise à l'échelle), là où zCX fait tourner des containers de façon plus isolée, sans orchestration.
