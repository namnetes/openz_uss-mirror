# Perspectives et synergies

!!! warning "En cours de spécification"
    Les usages décrits ci-dessous ne sont pas des objectifs actuels du projet. Ils dépendent de projets connexes distincts, à des stades très différents — certains non terminés, d'autres non encore commencés — et ne sont mentionnés ici que pour situer ce miroir USS (*Unix System Services*) dans une perspective plus large. Les réflexions menées sur cette page peuvent donc être structurantes pour ces projets connexes : autant de contraintes ou d'options à prendre en compte dès leur cadrage, plutôt qu'à découvrir une fois ce miroir en place.

!!! info "Prérequis"
    Cette page suppose une connaissance du mécanisme de synchronisation USS décrit dans [Résilience et synchronisation USS](architecture/resilience/index.md) et de la procédure de vérification décrite dans [Gestion des incidents et reprise](architecture/gestion-incidents.md).

Ce mécanisme de synchronisation, une fois en place, dépasse le seul cas d'usage de la continuité d'activité.

## Optimisation potentielle de la chaîne de build

Aujourd'hui, les compilateurs s'exécutent sur z/OS alors que les sources résident sur GitLab : chaque pipeline de build commence donc par un transfert des sources depuis GitLab vers le Mainframe, avant les étapes de compilation proprement dites. Ce n'est pas un détail isolé : la compilation **et** l'exécution en production tournent toutes deux sur z/OS — c'est donc l'ensemble du cycle de vie applicatif qui consomme de la [matière z](glossaire.md#matiere-z), la capacité de traitement Mainframe, une ressource rare et coûteuse qu'il faut réserver à ce pour quoi elle excelle (compiler, exécuter en production) plutôt qu'à des tâches qui n'en ont pas besoin, comme un simple transfert de fichiers répété à chaque pipeline.

Une fois le miroir USS opérationnel et fiable (vérification ISO en continu, voir [Vérification de l'état ISO](architecture/gestion-incidents.md#verification-de-letat-iso)), les sources utiles à un build sont déjà présentes sur USS au moment où le pipeline se déclenche. Le pipeline pourrait alors **s'appuyer directement sur le workspace USS de la branche concernée** plutôt que de répéter ce transfert à chaque exécution — une économie de matière z, pas seulement de temps — sous réserve que la fraîcheur du workspace soit garantie au moment du build, ce que le heartbeat DB2 et la réconciliation périodique permettent de vérifier.

## Reconstruction du SI après cyberattaque

Le règlement européen [**DORA**](glossaire.md#dora) (*Digital Operational Resilience Act* — Règlement (UE) 2022/2554 du 14 décembre 2022 sur la résilience opérationnelle numérique du secteur financier), applicable depuis le **17 janvier 2025**, impose aux établissements bancaires une capacité de **reconstruction de leur SI (*Système d'Information*)** en cas de cyberattaque réussie — au-delà de la simple continuité d'activité visée par ce projet. Son article 12 fixe en particulier des exigences de politiques de sauvegarde et de procédures de restauration testées régulièrement.

Le miroir USS, en tant que copie certifiable et horodatée des sources GitLab hébergée dans le périmètre z/OS natif, constitue une source potentielle pour alimenter une sauvegarde sécurisée des sources applicatives. Un projet distinct, dédié à la mise en place de sauvegardes sécurisées (avec tests de restauration réguliers), pourrait s'appuyer sur ce miroir plutôt que de mettre en place sa propre collecte de sources.

Pour une confrontation complète de l'architecture aux exigences de DORA (articles 5-31), à la doctrine ACPR et aux référentiels ISO/IEC 27001 et BCBS, voir [Conformité réglementaire](conformite-reglementaire.md).

## Prise d'image du patrimoine en production

Un outil de **prise d'image du patrimoine en production** photographie l'état des sources, soit de façon sélective, soit de façon globale sur l'ensemble du patrimoine, pour alimenter divers outils d'analyse.

Cet outil s'appuie sur le source de la branche `main` pour établir la [**bijection**](glossaire.md#bijection-source-load) entre le source et le *load module* ([*VLM*](glossaire.md#vlm-view-load-module) — *View Load Module*, le binaire compilé présent dans le périmètre de production), conformément à une recommandation de l'Inspection Générale ([IG](glossaire.md#ig-inspection-generale)) : à tout instant, l'auditeur doit pouvoir établir sans ambiguïté quel source a produit quel binaire — que ce binaire soit activement exécuté ou non. La bijection porte sur l'existence et la traçabilité du couple source/load, pas sur l'état d'activité du load module.

Le miroir USS, en maintenant `main` strictement identique à GitLab, pourrait servir de source directe à cet outil de prise d'image — sans transfert préalable depuis GitLab.

Cette documentation désigne désormais l'insertion de l'identifiant de package dans le binaire — le mécanisme qui matérialise concrètement la bijection décrite plus haut — par le terme imagé de « tatouage ».

!!! note "Moment de la pose du tatouage"
    Le tatouage est posé **au moment du build/link-edit**, par la CI — que celle-ci s'exécute de façon unitaire (un package) ou via la procédure de masse (recompilation globale du patrimoine). Il n'y a pas de « prise d'image » a posteriori distincte du build : le binaire de production est tatoué dès sa fabrication.

    Sous ChangeMan, la procédure prend elle-même en charge l'insertion de l'identifiant de package : **le source n'est jamais modifié**. Le mécanisme est standard — l'identifiant est écrit dans un [**IDR**](glossaire.md#idr-identification-record) (*Identification Record*) du load module, via l'instruction **`IDENTIFY`** du [*binder*](glossaire.md#binder). Même sans instruction explicite, le binder y inscrit déjà automatiquement sa propre version et la date du link-edit, ainsi que la date de compilation si le compilateur la fournit — c'est ce mécanisme déjà prévu par IBM que ChangeMan réutilise pour y ajouter l'identifiant de package. Les IDR sont consultables directement sur le load module via l'option `LISTIDR` de l'utilitaire [**AMBLIST**](glossaire.md#amblist), sans avoir besoin de remonter au source.

    Le lien package ↔ commit ↔ load est, lui, stocké côté **DB2** : c'est DB2 qui porte la mémoire de traçabilité de la plateforme (au même titre que `SYNC_STATUS` pour la synchronisation USS, voir [Heartbeat DB2](architecture/resilience/detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)). Cette information vient enrichir le **registre central de traçabilité des packages déjà existant**, plutôt qu'une table dédiée séparée : l'identifiant de package en est déjà le discriminant principal, ce registre est donc la clé d'entrée naturelle pour y associer le commit et le load module correspondants.

    Deux nuances pour les copybooks et l'assembleur : un **copybook** (COBOL/C) n'est pas une unité de compilation autonome — il est inclus (`COPY`) dans N programmes et n'a pas d'IDR propre ; sa modification impose de recompiler (et donc de retatouer) tous les programmes qui l'incluent. Pour l'**assembleur HLASM**, le link-edit peut agréger plusieurs [*object decks*](glossaire.md#object-deck) en un seul load module (programme principal + sous-programmes liés) : la bijection n'est donc pas toujours strictement 1 source ↔ 1 load, même dans ce cas dit « unitaire ».

!!! note "Panels ISPF et REXX — pourquoi ce cas est clos"
    Ces composants relèvent de l'outillage (automatisation, écrans de saisie) : une règle de gouvernance interdit d'y porter du traitement bancaire en production. N'étant jamais le binaire qui produit un résultat métier en production, ils ne sont pas concernés par l'exigence de bijection source/load de l'IG (*Inspection Générale*) — il n'y a rien à justifier pour ce cas, et donc rien à tatouer.

??? info "Grain du tatouage — objets modernes (Java, CICS-OSGi, Python, Node.js)"
    Contrairement à un programme COBOL/C/HLASM compilé unitairement, l'unité de build de ces écosystèmes est le **projet** (module Maven/Gradle, paquet Python, paquet npm), qui agrège plusieurs fichiers sources en un seul artefact (JAR, bundle OSGi, wheel, paquet npm). Le tatouage se pose donc au niveau de l'artefact produit, pas du fichier source individuel.

    Chaque écosystème dispose d'un **manifeste natif**, dans lequel on injecte un discriminant : pas le numéro de version applicatif (propre à chaque écosystème, donc non comparable d'un langage à l'autre), mais le **même identifiant de package** que pour le cas COBOL — pour garder une clé de jointure unique vers le registre DB2 de traçabilité, quel que soit le langage du composant.

    | Écosystème | Manifeste natif | Discriminant ajouté |
    |---|---|---|
    | Java / CICS-OSGi | `MANIFEST.MF` | Header custom `X-Package-Id` |
    | Python | métadonnées du wheel | Module généré exposant `__package_id__` |
    | Node.js | `package.json` | Champ custom `packageId` |

    Ce choix n'est pas qu'une question d'audit : c'est ce même identifiant, lu en clair dans le manifeste, que l'**outil d'archivage des sources et load modules obsolètes** (voir [plus bas](#archivage-des-sources-et-load-modules-obsoletes)) utilisera pour retrouver et regrouper le projet source et l'artefact binaire correspondants au moment d'archiver un composant. Le tatouage doit donc rester lisible directement par un outil externe — un manifeste en clair convient, un hash opaque seul ne suffirait pas.

!!! note "Grain du tatouage — procédures stockées SQL natives DB2 for z/OS"
    Une procédure stockée **externe** (`CREATE PROCEDURE ... EXTERNAL NAME`, écrite en COBOL ou en Java) n'introduit aucun cas nouveau : DB2 ne fait qu'appeler un load module ou une classe Java déjà couverts par les cas ci-dessus. Le cas réellement distinct est la **procédure stockée SQL native** (*Native SQL Procedure*, `LANGUAGE SQL`) : le source est l'instruction `CREATE PROCEDURE` elle-même, compilée par DB2 et stockée comme package dans son propre catalogue (`SYSIBM.SYSROUTINES`, `SYSIBM.SYSPACKAGE`) — il n'existe aucun load module externe sur lequel poser un IDR.

    DB2 fournit son propre équivalent fonctionnel de l'`IDENTIFY` du binder : la clause **`VERSION`** de `CREATE PROCEDURE` / `ALTER PROCEDURE ... ADD VERSION` accepte jusqu'à 64 caractères EBCDIC de texte libre, attachés à une version précise de la procédure, sans invalider les appelants existants (`ALTER PROCEDURE ... ACTIVATE VERSION` pour basculer la version active). C'est dans ce champ que s'écrit l'identifiant de package, exactement comme pour l'IDR. Le catalogue DB2 (`SYSPACKAGE.BINDTIME`) joue le rôle de la date de link-edit.

    Le source SQL PL reste versionné dans GitLab/USS comme tout le reste — le catalogue DB2 n'est qu'un point de vérification du tatouage, pas un système de gestion de source : IBM le précise explicitement dans sa documentation.

    **DRS n'introduit aucun cas supplémentaire.** Un service DRS n'est qu'une définition de routage (URL REST → appel d'une procédure stockée déjà existante) : il ne contient aucune logique métier propre et hérite simplement de la bijection de la procédure qu'il invoque, qu'elle soit externe ou native.

    ??? info "Références IBM"
        - [Versioning DB2 for z/OS native SQL stored procedures](https://www.ibm.com/docs/en/ida/9.2.x?topic=procedures-versioning-db2-zos-native-sql-stored)
        - [Db2 SQL — CREATE PROCEDURE (SQL - native)](https://www.ibm.com/docs/en/db2-for-zos/12.0.0?topic=statements-create-procedure-sql-native)
        - [SYSIBM.SYSPACKAGE catalog table](https://www.ibm.com/docs/en/db2-for-zos/12.0.0?topic=tables-syspackage)
        - [Robert's Db2 blog — Db2 for z/OS: Native SQL, or Java?](https://robertsdb2blog.blogspot.com/2014/10/db2-for-zos-stored-procedures-native.html)

!!! note "Cas particulier — alimentation de Mia Discovery"
    Avec l'ancienne chaîne CI/CD (*Continuous Integration / Continuous Delivery*) **ChangeMan**, un outil de prise d'image spécifique avait été développé pour alimenter [**Mia Discovery**](glossaire.md#mia-discovery), le logiciel de cartographie applicative du patrimoine, hébergé hors du Mainframe sur un serveur Windows.

    Avec la délocalisation des sources sur GitLab, ce traitement se simplifie : la collecte est désormais réalisée **directement depuis le serveur Windows**, par interrogation de GitLab. Cet outil n'a donc pas besoin du miroir USS — il ne transite plus du tout par le Mainframe.

## Archivage des sources et load modules obsolètes

Dans la même lignée, un autre outil est destiné à archiver les sources obsolètes ainsi que les *load modules* de production correspondants, afin de garantir strictement la bijection imposée par l'IG même après le retrait d'un composant du périmètre actif.

Dans ce cadre, le miroir USS serait actualisé par le mécanisme de synchronisation dès qu'une suppression logique est effectuée sur GitLab. L'archivage consiste à retirer les sources et les loads du périmètre actif tout en maintenant leur accessibilité via des processus dédiés — une démarche cohérente avec les obligations générales de conservation et de traçabilité documentaire applicables au secteur bancaire, sans qu'un texte impose littéralement l'archivage de ce couple source/load.

Pour les composants modernes (Java, CICS-OSGi, Python, Node.js), c'est l'**identifiant de package lu dans le manifeste** de l'artefact (voir [Grain du tatouage](#prise-dimage-du-patrimoine-en-production)) qui permet à cet outil de retrouver le projet source correspondant — l'unité archivée est donc le **projet pointé par le manifeste**, pas un fichier source isolé, cohérent avec le grain de la bijection retenu pour ces écosystèmes.

Le déclencheur de cet archivage n'est pas technique mais métier : c'est le **gestionnaire du patrimoine applicatif** — l'utilisateur propriétaire de l'application au sens de la cartographie [CAPIREF](glossaire.md#application-code-capiref) — qui demande l'archivage d'un composant qu'il juge obsolète. La rétention de ces archives n'est, par construction, soumise à aucune limite de durée.

!!! info "Traçabilité de la demande d'archivage"
    Au même titre que l'exécution technique de l'archivage doit être journalisée, la décision elle-même (qui a demandé l'archivage de quel composant, et quand) devrait être tracée avec la même rigueur — ce point n'est pas encore formalisé, voir [Points non couverts](points-ouverts.md#tracabilite-de-la-demande-darchivage).

### Suppression totale d'un dépôt applicatif

L'archivage décrit ci-dessus porte sur un **composant** devenu obsolète au sein d'une application qui reste active — c'est ce cas qui justifie une rétention indéfinie, pour préserver la bijection source/load exigée par l'IG (*Inspection Générale*). Deux cas distincts, où c'est l'**application entière** qui disparaît, ne sont pas soumis à cette même contrainte et appellent au contraire une suppression totale et sans exception du dépôt, y compris le dépôt lui-même :

- **Arrêt définitif d'une application** : lorsqu'une application est définitivement décommissionnée, ou que certains de ses composants sont supprimés, le code applicatif n'a plus vocation à être conservé — il a vocation à être **réutilisé sur un tout nouveau projet**, sans aucun lien fonctionnel ni historique avec l'ancien. Conserver le dépôt initial entretiendrait une confusion entre l'ancien périmètre et le nouveau ; sa suppression totale permet de repartir sur une base propre.
- **Migration de version majeure** : lors d'une transition entre la version 1 d'un progiciel (par exemple code applicatif `DYHO`) et sa version 2, la stratégie cible consiste à créer une **application distincte** (par exemple `DYHP`) plutôt que de faire évoluer `DYHO` en place. Cette isolation sécurise le retour arrière : `DYHO` reste intacte et fonctionnelle en production pendant toute la phase de transition, et un bug critique sur la V2 permet un retour immédiat à la V1. Une fois `DYHP` stable et validée en production, `DYHO` et son dépôt associé peuvent être définitivement supprimés.

!!! note "Pourquoi ce cas diffère de l'archivage de composant"
    Dans les deux cas ci-dessus, le périmètre CAPIREF lui-même (l'application) cesse d'exister : il n'y a donc plus de bijection source/load à garantir pour un périmètre qui n'est plus actif, contrairement à l'archivage d'un composant au sein d'une application qui continue, elle, de tourner en production. Le déclencheur reste le même — le gestionnaire du patrimoine applicatif — mais la décision est binaire (suppression totale) plutôt qu'une mise en rétention indéfinie.

## Recompilation de masse du patrimoine

Un outil de **recompilation de masse** des composants du patrimoine applicatif est utilisé dans deux situations types :

- l'intégration d'un nouveau progiciel ou d'une nouvelle version de progiciel ;
- une montée de version du compilateur COBOL, nécessitant de recompiler le parc existant avec le nouveau compilateur.

Cet outil doit, selon le cas :

- créer automatiquement de nouvelles branches GitLab ;
- importer de nouveaux sources ;
- effectuer l'ensemble des opérations classiques de CI/CD (build, tests, packaging).

Comme pour la prise d'image, et sur le même principe que celui posé dans [Optimisation potentielle de la chaîne de build](#optimisation-potentielle-de-la-chaine-de-build), ce traitement de masse pourrait s'appuyer sur les workspaces USS déjà synchronisés plutôt que de récupérer les sources depuis GitLab pour chaque composant à recompiler.

!!! note "Identité de l'exécutant — un héritage à préserver"
    Sous ChangeMan, qu'il s'agisse d'un développeur ou d'une équipe support, chacun utilise l'outil et ses API avec ses **droits [RACF](glossaire.md#racf) personnels** : aucun utilisateur technique générique n'est employé. Chaque action reste donc individuellement imputable, sans dispositif de traçabilité supplémentaire à concevoir.

    Ce principe doit être préservé côté Git : les actions de cet outil (création de branche, import de sources, build) devraient elles aussi s'exécuter pour le compte de l'utilisateur réel — et non d'un compte de service partagé — pour conserver la même imputabilité individuelle. Le mécanisme technique pour y parvenir côté API GitLab (jeton personnel, *impersonation*, OAuth) reste à définir, voir [Points non couverts](points-ouverts.md#identite-de-lexecutant-pour-les-outils-interactifs).

---

Ce projet de résilience USS n'est donc pas isolé : il s'inscrit dans un ensemble plus large d'initiatives de continuité, d'audit réglementaire et de reconstruction du SI bancaire.
