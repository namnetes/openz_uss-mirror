# Glossaire

!!! info "Public visé"
    Ce glossaire vulgarise les termes techniques utilisés dans le reste de la documentation, pour un lecteur qui ne connaît ni Git, ni le Mainframe, ni la plateforme bancaire. Les définitions privilégient l'intuition plutôt que l'exactitude technique complète — pour le détail précis, voir la page concernée.

## A

**AMBLIST**{: #amblist }
Un utilitaire IBM standard qui permet d'inspecter le contenu d'un load module — notamment ses IDR — sans avoir besoin de l'exécuter, via son option `LISTIDR`.

**API REST**{: #api-rest }
Un moyen standardisé pour deux logiciels de se parler à travers le réseau, en s'échangeant de courts messages structurés (souvent au format JSON). GitLab expose ainsi une API REST qui permet d'interroger ou de piloter un dépôt sans passer par l'interface web.

**Application (code CAPIREF)**{: #application-code-capiref }
Dans la cartographie d'entreprise, chaque application du système d'information est identifiée par un code unique sur deux caractères alphanumériques, préfixé par `DA` (développement propriétaire LCL) ou `DY` (progiciel, c'est-à-dire un logiciel acheté à un éditeur) selon le type d'application — par exemple `DA12` ou `DY07`.

## B

**BAL**{: #bal }
Une boîte aux lettres électronique partagée par une équipe ou un service, par opposition à une adresse email individuelle — c'est l'adresse qui reçoit les alertes automatiques destinées à toute une équipe plutôt qu'à une personne en particulier.

**Bijection (source ↔ load)**{: #bijection-source-load }
Le fait de pouvoir établir, sans ambiguïté et dans les deux sens, quel code source a produit quel binaire de production, et inversement. C'est une exigence d'audit : on doit pouvoir remonter du binaire qui tourne en production jusqu'au code exact qui l'a généré.

**Binder**{: #binder }
L'utilitaire z/OS qui réalise l'édition de liens (*link-edit*) : il assemble un ou plusieurs object decks compilés en un seul load module exécutable, et peut y inscrire automatiquement des métadonnées (version, date) dans son IDR.

**Branche (Git)**{: #branche-git }
Une ligne de développement indépendante au sein d'un même projet — par exemple, une branche par correctif ou par nouvelle fonctionnalité, qui n'affecte pas le code des autres branches tant qu'elle n'est pas fusionnée.

## C

**ChangeMan**{: #changeman }
La solution propriétaire de gestion de configuration et de déploiement (CI/CD) utilisée historiquement sur le Mainframe, avant l'adoption de Git et GitLab décrite dans ce projet. Le patrimoine applicatif géré par ChangeMan est progressivement repris par la nouvelle chaîne outillée autour de Git.

**CI/CD**{: #ci-cd }
*Continuous Integration / Continuous Delivery* — l'ensemble des étapes automatisées qui transforment un code source en un programme testé, packagé et prêt à être déployé en production (compilation, tests, packaging, promotion).

**CICS**{: #cics }
*Customer Information Control System* — le moniteur transactionnel IBM Mainframe qui exécute les programmes traitant les transactions en ligne (par opposition aux traitements batch). Les nouveaux développements CICS peuvent être écrits en Java, packagés sous forme de *bundle* OSGi (voir plus bas).

**Commit (Git)**{: #commit-git }
Un instantané enregistré du code à un moment donné, avec un message expliquant ce qui a changé. Chaque commit possède un identifiant unique (le *hash*, voir plus bas).

**Container**{: #container }
Un environnement logiciel isolé et léger, qui embarque une application et tout ce dont elle a besoin pour fonctionner, sans dépendre du reste du système qui l'héberge.

**Copybook**{: #copybook }
Un fichier COBOL (ou C) contenant des déclarations de données ou du code réutilisable, inclus dans un ou plusieurs programmes au moment de la compilation (instruction `COPY`). Un copybook n'est pas compilé seul : il n'a pas de binaire propre, et sa modification impose de recompiler tous les programmes qui l'incluent.

## D

**Data sharing (DB2)**{: #data-sharing-db2 }
Une configuration DB2 for z/OS où plusieurs instances du gestionnaire de base de données, réparties sur différents systèmes, accèdent en écriture concurrente aux mêmes données partagées, avec une vue cohérente garantie entre elles — utilisée pour la haute disponibilité entre datacenters.

**DB2 for z/OS**{: #db2-for-z-os }
La base de données utilisée par la plateforme Mainframe pour stocker de façon fiable des informations de suivi (par exemple : quel commit est actuellement synchronisé sur quelle branche).

**DRS (Db2 REST Services)**{: #drs-db2-rest-services }
Le composant qui permet à un programme d'interroger ou de mettre à jour DB2 via de simples appels API REST, sans avoir à parler le langage natif de la base de données.

**DORA**{: #dora }
*Digital Operational Resilience Act* — un règlement européen qui impose aux établissements financiers de pouvoir continuer à fonctionner, ou se reconstruire rapidement, en cas d'incident informatique majeur (panne, cyberattaque).

## G

**Gigue (*jitter*)**{: #gigue-jitter }
Un léger décalage, imprévisible d'une exécution à l'autre, entre le moment où une tâche périodique *devrait* s'exécuter et le moment où elle s'exécute *réellement* — par exemple un job planifié censé tourner toutes les 5 minutes mais qui démarre parfois avec quelques secondes ou minutes de retard, selon la charge du système. Une marge de sécurité (comme un seuil d'alerte plus large que la fréquence de contrôle) permet d'absorber cette gigue sans déclencher de fausse alerte.

**Git**{: #git }
Un outil qui permet de suivre l'historique des modifications d'un code source : qui a changé quoi, quand, et de revenir en arrière si besoin. C'est la brique de base sur laquelle GitLab est construit.

**GitLab**{: #gitlab }
Une plateforme web qui héberge les dépôts Git de l'entreprise et automatise les étapes de CI/CD (construction, tests, déploiement) à partir de ce code source.

## H

**Hash (de commit)**{: #hash-de-commit }
Une suite de caractères qui identifie de façon unique un état précis du code. Deux copies identiques du même code produisent toujours le même hash — c'est ce qui permet de vérifier que deux endroits (par exemple GitLab et USS) contiennent exactement la même chose, sans comparer fichier par fichier.

**HEAD**{: #head }
Dans Git, le pointeur qui désigne le commit actuellement « extrait » (*checked out*) dans un répertoire de travail donné — c'est-à-dire l'état exact du code présent sur le disque à cet instant.

**Heartbeat**{: #heartbeat }
Un signal envoyé à intervalle régulier pour prouver qu'un service est toujours actif. Si le signal s'arrête, c'est le signe que quelque chose ne fonctionne plus, même sans message d'erreur explicite.

**HLASM**{: #hlasm }
*High Level Assembler* — le langage assembleur utilisé sur Mainframe, le plus proche du fonctionnement matériel du processeur. Comme pour le COBOL, un source HLASM est compilé (assemblé puis linké) en un load module.

## I

**IDR (Identification Record)**{: #idr-identification-record }
Une zone du load module ou du *program object*, prévue par IBM dans le format binaire, où le *binder* inscrit automatiquement sa propre version et la date du link-edit — et la date de compilation si le compilateur la fournit. L'instruction `IDENTIFY` du binder permet d'y ajouter du texte libre (jusqu'à 80 caractères) sans toucher au source : c'est ce mécanisme que ChangeMan réutilise pour y inscrire l'identifiant de package. Consultable via l'option `LISTIDR` de l'utilitaire AMBLIST.

**Idempotent**{: #idempotent }
Une opération est dite idempotente quand la répéter plusieurs fois produit toujours le même résultat que l'exécuter une seule fois — sans effet de bord supplémentaire. Par exemple, traiter deux fois le même événement de push ne crée pas deux workspaces, ni n'applique deux fois le même changement.

**IG (Inspection Générale)**{: #ig-inspection-generale }
La fonction d'audit interne de l'établissement, chargée de vérifier que les règles de contrôle et de gestion des risques sont bien respectées. Certaines de ses recommandations (comme l'exigence de bijection source/binaire) s'imposent aux projets informatiques.

**Impersonation**{: #impersonation }
Un mécanisme d'API où un compte de service peut agir « pour le compte » d'un autre utilisateur identifié, tout en conservant la traçabilité de l'identité réelle à l'origine de l'action.

**ISO (état)**{: #iso-etat }
Dans cette documentation, ne désigne pas la norme ISO mais le sens littéral d'« identique » : un workspace USS est dit « ISO » lorsqu'il contient exactement le même code que la branche GitLab correspondante.

## J

**jq**{: #jq }
Un outil en ligne de commande qui permet de lire, filtrer et transformer des données au format JSON, un peu comme `grep` ou `sed` pour du texte structuré — pratique pour interroger un journal ou une réponse d'API sans écrire de script dédié.

## L

**LPAR**{: #lpar }
*Logical Partition* — une partition logique d'un Mainframe, qui se comporte comme une machine indépendante tout en partageant le matériel physique avec d'autres partitions.

**Load module**{: #load-module }
Le programme compilé, prêt à être exécuté, obtenu après compilation et édition de liens du code source. C'est ce binaire qui tourne réellement en production — voir aussi *VLM*.

## M

**Mainframe**{: #mainframe }
Un ordinateur central de très grande capacité, utilisé dans les environnements bancaires pour sa fiabilité et sa puissance de traitement. Le système d'exploitation utilisé ici est z/OS (voir plus bas).

**Matière z**{: #matiere-z }
Une expression familière désignant l'ensemble du patrimoine applicatif Mainframe, par opposition aux technologies « hors z » (serveurs modernes, systèmes distribués). « Consommer de la matière z » signifie utiliser de la capacité de traitement Mainframe — une ressource rare et coûteuse, à réserver aux tâches qui en ont réellement besoin.

**Mia Discovery**{: #mia-discovery }
Le logiciel de cartographie applicative du patrimoine — il dresse l'inventaire des applications et de leurs composants, indépendamment de ce projet de miroir USS.

**Miroir**{: #miroir }
Une copie d'un ensemble de données, maintenue à jour en continu et destinée à rester strictement identique à l'original — ici, à but de continuité d'activité et de preuve d'audit, et non de travail quotidien.

**Mode dégradé**{: #mode-degrade }
Un mode de fonctionnement temporaire, activé quand un système habituel (ici GitLab) est indisponible, qui permet de continuer les opérations essentielles via des procédures de secours, en attendant le retour à la normale.

## N

**Native SQL Procedure**{: #native-sql-procedure }
Une procédure stockée DB2 for z/OS écrite directement en SQL (`CREATE PROCEDURE ... LANGUAGE SQL`), sans passer par un langage hôte comme COBOL ou Java. Le source est compilé par DB2 lui-même et stocké comme *package* dans son propre catalogue — il n'existe pas de load module externe pour ce type de procédure, contrairement à une procédure stockée *externe* (COBOL/Java) qui en produit bien un.

**NTP**{: #ntp }
*Network Time Protocol* — le protocole standard qui synchronise l'horloge de plusieurs ordinateurs entre eux sur un réseau, pour garantir qu'ils mesurent tous le temps de la même façon.

## O

**Object deck**{: #object-deck }
Le fichier binaire intermédiaire produit par un compilateur (COBOL, HLASM...) avant l'édition de liens — pas encore exécutable seul, il doit être assemblé avec d'éventuels autres object decks par le binder pour former un load module.

**OSGi (bundle)**{: #osgi-bundle }
*Open Service Gateway initiative* — une norme Java qui permet de packager du code sous forme de **bundles** : des modules autonomes, versionnés, qui déclarent explicitement ce qu'ils utilisent et ce qu'ils exposent. C'est le format utilisé pour les nouveaux développements de transactions CICS en Java sur cette plateforme — un bundle agrège plusieurs classes Java, l'unité de build et de déploiement étant le bundle, pas la classe individuelle.

## P

**Package**{: #package }
Une unité de livraison versionnée — l'ensemble cohérent de changements de code regroupés pour être construits, testés et déployés ensemble, identifié par un numéro unique.

**Panel ISPF**{: #panel-ispf }
Un écran de saisie ou d'affichage défini dans un membre PDS (*Partitioned Data Set* — une bibliothèque de membres sur Mainframe), interprété à l'exécution par ISPF (*Interactive System Productivity Facility*, l'environnement interactif du Mainframe) — pas compilé ni linké comme un programme. Il n'existe donc pas de binaire à proprement parler pour un panel : seule la version du membre source fait foi.

**PAR JCL**{: #par-jcl }
Un membre JCL (*Job Control Language* — le langage de script qui décrit l'enchaînement d'un traitement batch sur Mainframe) de type procédure ou paramètre, conçu pour être réutilisé par plusieurs jobs plutôt qu'écrit une fois par job.

**PassTicket**{: #passticket }
Un mécanisme de sécurité Mainframe qui permet à un programme de prouver son identité auprès d'un autre composant interne (par exemple DB2) sans avoir à stocker ou transmettre un mot de passe en clair, en utilisant un secret partagé à usage unique.

**Personal Access Token (jeton d'accès personnel)**{: #personal-access-token-jeton-dacces-personnel }
Un jeton d'authentification généré individuellement par un utilisateur GitLab, utilisable à la place d'un mot de passe pour les appels API ou les commandes Git en ligne de commande.

**Plan de continuité et de reprise d'activité**{: #plan-de-continuite-et-de-reprise-dactivite }
Le dispositif global d'un établissement bancaire qui définit comment l'activité continue ou reprend après un sinistre majeur (panne, catastrophe, cyberattaque). Le miroir USS décrit dans cette documentation en est l'un des dispositifs, à l'échelle de la chaîne CI/CD.

## R

**RACF**{: #racf }
*Resource Access Control Facility* — le système de sécurité du Mainframe qui gère les identités, les habilitations et les autorisations d'accès — l'équivalent, pour le Mainframe, d'un système de gestion des comptes et des droits.

**REXX**{: #rexx }
*Restructured Extended Executor* — un langage de script interprété, utilisé sur le Mainframe pour automatiser des tâches (par exemple piloter des panels ISPF). Comme les panels ISPF, un source REXX n'est pas compilé en binaire : il est exécuté directement.

**Réconciliation**{: #reconciliation }
Une vérification périodique qui compare l'état réellement enregistré (par exemple sur USS) avec une source de référence (GitLab), pour détecter et corriger automatiquement les écarts.

**Runbook**{: #runbook }
Un anglicisme désignant une procédure documentée, pas à pas, indiquant quoi faire en cas d'incident précis — l'équivalent d'un guide de dépannage destiné à l'équipe d'exploitation plutôt qu'aux développeurs.

## S

**SI**{: #si }
*Système d'Information* — l'ensemble des ressources (matériels, logiciels, données, procédures) qui permettent à une organisation de collecter, traiter et faire circuler l'information nécessaire à son activité.

**SLA**{: #sla }
*Service Level Agreement* — un engagement chiffré de niveau de service, ici la disponibilité (ex. 99,99 %, soit environ 52 minutes d'indisponibilité tolérée par an). Dans cette documentation, le SLA de 99,99 % vise la disponibilité globale du Mainframe et de ses applications — un niveau historiquement atteint nativement par l'infrastructure z/OS. La modernisation (recours à GitLab et à des briques hors z) introduit une dépendance externe qui pourrait dégrader ce niveau ; le miroir USS est le dispositif de mitigation qui permet de continuer à tenir ce SLA via un mode dégradé, en cas d'indisponibilité de ces briques externes.

**STC**{: #stc }
*Started Task* — un type de tâche Mainframe démarrée automatiquement par le système d'exploitation plutôt que par un utilisateur, et destinée à tourner en continu (par opposition à un job batch, qui se termine une fois son traitement achevé).

**Synchronisation**{: #synchronisation }
Le mécanisme qui maintient deux emplacements (ici GitLab et USS) constamment alignés : chaque changement effectué d'un côté est répercuté de l'autre côté, sans intervention humaine.

## T

**TWS/OPC**{: #tws-opc }
*Tivoli Workload Scheduler* — l'ordonnanceur qui planifie et déclenche automatiquement l'exécution des traitements batch sur le Mainframe, selon un calendrier ou des dépendances entre jobs.

## U

**USS (Unix System Services)**{: #uss-unix-system-services }
Un environnement compatible Unix qui tourne au sein de z/OS, permettant d'utiliser des outils standards (comme Git) directement sur le Mainframe.

## V

**VLM (View Load Module)**{: #vlm-view-load-module }
Le terme utilisé en interne pour désigner le binaire compilé déployé en production — synonyme de *load module* dans ce contexte. C'est aussi le nom d'une fonctionnalité du logiciel **File Manager** (IBM), qui permet de visualiser le contenu d'un load module.

## W

**Webhook**{: #webhook }
Une notification automatique envoyée par un service (ici GitLab) vers un autre dès qu'un événement se produit (un nouveau commit, une branche créée ou supprimée) — l'inverse d'une vérification périodique : c'est le service qui prévient, plutôt que d'être interrogé.

**WLM**{: #wlm }
*Workload Manager* — le composant z/OS qui répartit les ressources du système (processeur, mémoire) entre les différentes tâches actives, en fonction de la priorité et des objectifs de performance définis pour chacune.

**Workspace**{: #workspace }
Un répertoire de travail dédié à une branche donnée, contenant son code source à jour. Dans ce projet, chaque branche active dispose de son propre workspace sur USS.

**Worktree (`git worktree`)**{: #worktree-git-worktree }
Une fonctionnalité de Git qui permet d'avoir plusieurs répertoires de travail (un par branche) issus du même dépôt, sans dupliquer l'historique complet pour chacun — seuls les fichiers propres à chaque branche occupent de l'espace disque supplémentaire.

## Z

**z/OS**{: #z-os }
Le système d'exploitation du Mainframe IBM utilisé par la plateforme bancaire.

**zCX (z/OS Container Extensions)**{: #zcx-z-os-container-extensions }
La technologie qui permet de faire tourner des containers Linux directement sur z/OS, sans machine séparée — c'est l'environnement dans lequel s'exécute le service de synchronisation USS.

**z/OS Container Platform (zCP)**{: #z-os-container-platform-zcp }
Une évolution plus récente de zCX, basée sur Kubernetes : elle permet d'orchestrer plusieurs containers sur z/OS (répartition de charge, redémarrage automatique, mise à l'échelle), là où zCX fait tourner des containers de façon plus isolée, sans orchestration.

**zFS**{: #zfs }
*z/OS File System* — le système de fichiers utilisé par USS pour stocker ses données sur disque, l'équivalent Mainframe d'un système de fichiers comme ext4 ou NTFS sur un serveur classique.
