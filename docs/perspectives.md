# Perspectives et synergies

!!! warning "En cours de spécification"
    Les usages décrits ci-dessous ne sont pas des objectifs actuels du projet. Ils dépendent de projets connexes distincts, non terminés à ce jour, et ne sont mentionnés ici que pour situer ce miroir USS dans une perspective plus large.

!!! info "Prérequis"
    Cette page suppose une connaissance du mécanisme de synchronisation USS décrit dans [Résilience et synchronisation USS](architecture/resilience.md) et de la procédure de vérification décrite dans [Gestion des incidents et reprise](architecture/gestion-incidents.md).

Ce mécanisme de synchronisation, une fois en place, dépasse le seul cas d'usage de la continuité d'activité.

## Optimisation potentielle de la chaîne de build

Aujourd'hui, les compilateurs s'exécutent sur z/OS alors que les sources résident sur GitLab : chaque pipeline de build commence donc par un transfert des sources depuis GitLab vers le Mainframe, avant les étapes de compilation proprement dites.

Une fois le miroir USS opérationnel et fiable (vérification ISO en continu, voir [Vérification de l'état ISO](architecture/gestion-incidents.md#verification-de-letat-iso)), les sources utiles à un build sont déjà présentes sur USS au moment où le pipeline se déclenche. Le pipeline pourrait alors **s'appuyer directement sur le workspace USS de la branche concernée** plutôt que de répéter ce transfert à chaque exécution — sous réserve que la fraîcheur du workspace soit garantie au moment du build, ce que le heartbeat DB2 et la réconciliation périodique permettent de vérifier.

## Reconstruction du SI après cyberattaque

Le règlement européen **DORA** (*Digital Operational Resilience Act* — Règlement (UE) 2022/2554 du 14 décembre 2022 sur la résilience opérationnelle numérique du secteur financier), applicable depuis le **17 janvier 2025**, impose aux établissements bancaires une capacité de **reconstruction de leur SI (*Système d'Information*)** en cas de cyberattaque réussie — au-delà de la simple continuité d'activité visée par ce projet. Son article 12 fixe en particulier des exigences de politiques de sauvegarde et de procédures de restauration testées régulièrement.

Le miroir USS, en tant que copie certifiable et horodatée des sources GitLab hébergée dans le périmètre z/OS natif, constitue une source potentielle pour alimenter une sauvegarde sécurisée des sources applicatives. Un projet distinct, dédié à la mise en place de sauvegardes sécurisées (avec tests de restauration réguliers), pourrait s'appuyer sur ce miroir plutôt que de mettre en place sa propre collecte de sources.

## Prise d'image du patrimoine en production

Un outil de **prise d'image du patrimoine en production** photographie l'état des sources, soit de façon sélective, soit de façon globale sur l'ensemble du patrimoine, pour alimenter divers outils d'analyse.

Cet outil s'appuie sur le source de la branche `main` pour établir la **bijection** entre le source et le *load module* (*VLM* — *View Load Module*, le binaire compilé déployé en production), conformément à une recommandation de l'Inspection Générale (IG) : à tout instant, l'auditeur doit pouvoir établir sans ambiguïté quel source a produit quel binaire en production.

Le miroir USS, en maintenant `main` strictement identique à GitLab, pourrait servir de source directe à cet outil de prise d'image — sans transfert préalable depuis GitLab.

!!! note "Moment de la pose du tatouage"
    Le tatouage est posé **au moment du build/link-edit**, par la CI — que celle-ci s'exécute de façon unitaire (un package) ou via la procédure de masse (recompilation globale du patrimoine). Il n'y a pas de "prise d'image" a posteriori distincte du build : le binaire de production est tatoué dès sa fabrication.

    Reste ouverte la question du **grain** du tatouage pour les objets modernes (Java, Python, z/OS Connect) — voir [Points non couverts](points-ouverts.md#mecanisme-technique-du-tatouage-source-load-module).

!!! note "Cas particulier — alimentation de Mia Discovery"
    Avec l'ancienne chaîne CI/CD **ZMF ChangeMan**, un outil de prise d'image spécifique avait été développé pour alimenter **Mia Discovery**, le logiciel de cartographie applicative du patrimoine, hébergé hors du Mainframe sur un serveur Windows.

    Avec la délocalisation des sources sur GitLab, ce traitement se simplifie : la collecte est désormais réalisée **directement depuis le serveur Windows**, par interrogation de GitLab. Cet outil n'a donc pas besoin du miroir USS — il ne transite plus du tout par le Mainframe.

## Archivage des sources et load modules obsolètes

Dans la même lignée, un autre outil est destiné à archiver les sources obsolètes ainsi que les *load modules* de production correspondants, afin de garantir strictement la bijection imposée par l'IG même après le retrait d'un composant du périmètre actif.

Dans ce cadre, le miroir USS serait actualisé par le mécanisme de synchronisation dès qu'une suppression logique est effectuée sur GitLab. L'archivage consiste à retirer les sources et les loads du périmètre actif tout en maintenant leur accessibilité via des processus dédiés — une démarche cohérente avec les obligations générales de conservation et de traçabilité documentaire applicables au secteur bancaire, sans qu'un texte impose littéralement l'archivage de ce couple source/load.

Le déclencheur de cet archivage n'est pas technique mais métier : c'est le **gestionnaire du patrimoine applicatif** — l'utilisateur propriétaire de l'application au sens de la cartographie CAPIREF — qui demande l'archivage d'un composant qu'il juge obsolète. La rétention de ces archives n'est, par construction, soumise à aucune limite de durée.

!!! info "Traçabilité de la demande d'archivage"
    Au même titre que l'exécution technique de l'archivage doit être journalisée, la décision elle-même (qui a demandé l'archivage de quel composant, et quand) devrait être tracée avec la même rigueur — ce point n'est pas encore formalisé, voir [Points non couverts](points-ouverts.md#tracabilite-de-la-demande-darchivage).

## Recompilation de masse du patrimoine

Un outil de **recompilation de masse** des composants du patrimoine applicatif est utilisé dans deux situations types :

- l'intégration d'un nouveau progiciel ou d'une nouvelle version de progiciel ;
- une montée de version du compilateur COBOL, nécessitant de recompiler le parc existant avec le nouveau compilateur.

Cet outil doit, selon le cas :

- créer automatiquement de nouvelles branches GitLab ;
- importer de nouveaux sources ;
- effectuer l'ensemble des opérations classiques de CI/CD (build, tests, packaging).

Comme pour la prise d'image, ce traitement de masse pourrait s'appuyer sur les workspaces USS déjà synchronisés plutôt que de récupérer les sources depuis GitLab pour chaque composant à recompiler.

---

Ce projet de résilience USS n'est donc pas isolé : il s'inscrit dans un ensemble plus large d'initiatives de continuité, d'audit réglementaire et de reconstruction du SI bancaire.
