# Points non couverts

!!! warning "Page de suivi"
    Cette page recense les questions d'architecture identifiées mais non encore tranchées. Elle doit être tenue à jour au fil des décisions : une fois une question résolue, son contenu migre vers la page concernée (`resilience.md`, `gestion-incidents.md`, `perspectives.md`) et l'entrée est retirée d'ici.

## Mécanisme technique du tatouage source ↔ load module

Sous ChangeMan, l'identifiant de package sert à tatouer le load module compilé, ce qui établit la bijection entre le source et le binaire de production. Le principe doit être repris côté chaîne Git. Le moment de la pose est tranché — au build/link-edit, par la CI, voir [Perspectives et synergies](perspectives.md#prise-dimage-du-patrimoine-en-production) — mais le mécanisme technique précis reste à définir sur les points suivants :

- Comment l'identifiant est-il physiquement embarqué dans le binaire (attribut du *program object*, instruction du binder, commentaire `IDENTIFICATION DIVISION` en COBOL, autre) ?
- Le lien package ↔ commit ↔ load doit-il être stocké dans le registre DB2 de traçabilité des packages déjà existant, ou dans une table dédiée ?
- **Quel est le grain du tatouage pour les objets modernes ?** En COBOL, la granularité la plus fine est le load module : 1 source = 1 load, donc 1 tatouage = 1 binaire. Pour les projets Java, Python ou z/OS Connect, ce n'est plus vrai — l'unité de build/déploiement est le **projet** (un JAR/WAR, une roue Python, un artefact de mapping z/OS Connect), qui agrège souvent plusieurs fichiers sources. La bijection à établir n'est donc pas "un fichier source ↔ un binaire" mais "un projet source ↔ un artefact binaire/package", avec le tatouage posé une fois par artefact de build (manifeste JAR, métadonnée de package Python, descripteur de déploiement z/OS Connect) et référençant le commit ou le tag du projet source dans son ensemble.

Sans réponse à ces questions, la bijection annoncée dans [Perspectives et synergies](perspectives.md) reste, pour les objets modernes, une intention non outillée — et sa définition même (fichier ↔ load vs projet ↔ artefact) doit être précisée selon la techno.

## Politique de purge du dépôt git

Les objets Git des branches supprimées (après merge ou déploiement) restent dans le dépôt principal tant qu'aucun `git gc`/repack agressif n'est exécuté. Reste à décider :

- Faut-il interdire toute purge, par cohérence avec la rétention "indéfinie" retenue pour l'archivage des sources et load modules obsolètes ?
- Si une purge est un jour nécessaire (volumétrie), quelle autorité métier ou réglementaire doit valider le délai de rétention minimal ?

C'est un point de fragilité identifié mais non résolu à ce stade.

## Topologie du service de sync entre les deux datacenters

L'infrastructure z/OS est en haute disponibilité sur deux datacenters, ce qui couvre la panne physique (storage, LPAR) et la disponibilité de DB2. Reste à préciser, pour le service de synchronisation lui-même (container zCX) :

- Fonctionne-t-il en actif/actif (une instance par datacenter, toutes deux capables de traiter des webhooks) ou en actif/passif (bascule sur panne du site primaire) ?
- Si actif/actif, comment éviter qu'un même webhook GitLab soit traité en double par les deux instances (verrou distribué, bascule au niveau de l'URL du webhook côté load balancer) ?
- Le heartbeat DB2 (`SYNC_STATUS`) est-il visible de façon cohérente depuis les deux sites (data sharing DB2), pour que la détection de panne reste fiable indépendamment du site actif ?

## Émergency fix pendant une panne GitLab

En mode dégradé, USS reste strictement en lecture (voir [Résilience et synchronisation USS](architecture/resilience.md#la-contrainte-de-depart)) et seules les actions de CI/CD (build, promotion, déploiement) sont rejouées manuellement à partir du dernier état synchronisé. Reste à clarifier le cas d'un correctif de code **urgent**, nécessaire alors que GitLab est inaccessible :

- Le mode dégradé interdit-il toute modification de code tant que GitLab n'est pas revenu (on ne fait que redéployer le dernier état connu) ?
- Ou existe-t-il une procédure de correctif d'urgence hors Git, à rejouer dans GitLab au retour de service via le [journal des actions en mode dégradé](architecture/gestion-incidents.md#mode-degrade-panne-gitlab) ?

## Sécurisation des échanges avec GitLab

L'authentification interne zCX ↔ DB2/DRS est couverte (compte technique + PassTicket RACF, voir [Heartbeat DB2](architecture/resilience.md#heartbeat-db2-detection-quasi-temps-reel)). Mais GitLab ne parle pas RACF — deux flux externes restent à sécuriser explicitement :

- **Webhook entrant GitLab → zCX** : authentification par *secret token* GitLab (en-tête `X-Gitlab-Token`), éventuellement complétée par un allowlist IP. Sans cela, n'importe qui connaissant l'URL du webhook pourrait déclencher une resynchronisation forcée. Reste à définir où ce secret est stocké côté zCX et comment il est généré/distribué.
- **Appels sortants zCX/job de réconciliation → API GitLab** : nécessite un compte de service GitLab dédié, à scope minimal (lecture des branches/commits), avec une politique de rotation du jeton à définir.

## Traçabilité de la demande d'archivage

Le déclenchement de l'archivage des sources et load modules obsolètes est porté par le gestionnaire du patrimoine applicatif (voir [Archivage des sources et load modules obsolètes](perspectives.md)). L'exécution technique de l'archivage sera journalisée comme le reste des opérations de cette plateforme, mais la décision elle-même — qui a demandé l'archivage de quel composant, et quand — n'a pas encore de mécanisme de traçabilité formalisé.
