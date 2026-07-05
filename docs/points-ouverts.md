# Points non couverts

!!! warning "Page de suivi"
    Cette page recense les questions d'architecture identifiées mais non encore tranchées. Elle doit être tenue à jour au fil des décisions : une fois une question résolue, son contenu migre vers la page concernée (`architecture/resilience/`, `gestion-incidents.md`, `perspectives.md`) et l'entrée est retirée d'ici.

!!! info "Prérequis"
    Cette page suppose une connaissance des mécanismes déjà posés dans [Résilience et synchronisation USS](architecture/resilience/index.md) et [Détection et gestion des défauts de synchro](architecture/resilience/detection-defauts.md) : DRS, RACF, heartbeat DB2, réconciliation périodique.

## Cadrage du SLA 99,99 % et dispositif de mitigation

Le [SLA](glossaire.md#sla) de 99,99 % visé par la plateforme porte sur la disponibilité globale du Mainframe et de ses applications — un niveau historiquement assuré nativement par l'infrastructure z/OS — et non sur le service de synchronisation USS pris isolément.

Le miroir USS a pour rôle de préserver ce SLA global en absorbant les indisponibilités de GitLab (une infrastructure externe au périmètre z/OS) via le mode dégradé : tant que GitLab répond, le mécanisme de synchronisation fonctionne normalement ; s'il tombe, USS permet de continuer à builder, promouvoir et déployer depuis le dernier état synchronisé, sans que cette panne externe ne se répercute sur la disponibilité perçue des applications Mainframe.

La vraie question de disponibilité à trancher n'est donc pas « le service de sync tient-il 99,99 % ? » mais « le mode dégradé se déclenche-t-il assez vite et de façon assez fiable pour que l'indisponibilité de GitLab ne se répercute jamais sur la disponibilité perçue des applications Mainframe elles-mêmes ? ». C'est cette question — la fiabilité du dispositif de mitigation lui-même — qui structure la section suivante.

## Fiabilité du dispositif de mitigation (constats de l'analyse technique)

Une analyse technique récente de l'architecture de résilience, menée au regard du SLA cadré ci-dessus, a mis en évidence plusieurs zones d'ombre sur la fiabilité du mode dégradé lui-même — c'est-à-dire sur sa capacité à effectivement absorber une indisponibilité de GitLab sans délai ni échec :

- Aucun RTO ni RPO n'est formellement engagé pour le service de synchronisation ni pour la procédure de resynchronisation — les seuls chiffres documentés (heartbeat, fenêtre de grâce GitLab, cadence de réconciliation) sont des délais de détection, jamais des engagements de résolution.
- Aucune auto-remédiation n'est prévue : rien n'indique que le container zCX redémarre automatiquement en cas de panne, ce qui fait reposer toute reprise sur une intervention humaine.
- Cette intervention humaine repose sur un opérateur sans astreinte, MTTA/MTTR ni couverture horaire documentés ; le canal d'alerte actuel (BAL email) est potentiellement inadapté à un besoin de réaction urgente.
- La bascule d'infrastructure (LPAR, stockage, réseau) est déjà couverte par des exercices [PSI](glossaire.md#psi-plan-de-secours-informatique) (*Plan de Secours Informatique*) réguliers, menés dans les deux sens entre les deux datacenters — le futur service de sync en bénéficiera nativement, puisqu'il sera hébergé sur une LPAR sécurisée elle-même ciblée par ces exercices.
- Ce que les PSI valident, c'est la bascule de l'infrastructure elle-même (la LPAR redémarre-t-elle correctement sur l'autre site) — pas le comportement fonctionnel du service de sync pendant cette bascule : le heartbeat détecte-t-il correctement l'interruption, les webhooks GitLab en attente sont-ils correctement rejoués après bascule, la réconciliation périodique rattrape-t-elle un éventuel écart créé pendant la fenêtre de bascule. Cette validation fonctionnelle ne pourra se faire qu'une fois le service développé — idéalement en l'intégrant à un prochain cycle de PSI plutôt qu'en la laissant hors périmètre. L'estimation « resynchronisation complète sous la minute pour 600 branches » (voir [Resynchronisation complète](architecture/gestion-incidents.md#resynchronisation-complete)) reste elle aussi un calcul théorique non testé — mais elle concerne la performance du service applicatif, pas la bascule d'infrastructure.
- La capacité de montée en charge du service de sync n'est pas modélisée : aucun débit maximal, aucune stratégie d'absorption de pic (ex. déclenché par une recompilation de masse générant de nombreux événements en rafale) n'est documentée.
- La résilience du réseau inter-datacenters n'est jamais analysée comme surface de panne propre (partition réseau, split-brain), alors qu'elle conditionne la sûreté d'une future topologie actif/actif (voir [Topologie du service de sync entre les deux datacenters](#topologie-du-service-de-sync-entre-les-deux-datacenters) plus bas dans ce même fichier).
- Aucun monitoring applicatif réel n'existe au-delà de l'alerte binaire du heartbeat : pas de tableau de bord, pas de suivi de budget d'erreur, pas de télémétrie sur l'âge du dernier événement traité par branche.
- La cadence de réconciliation (« potentiellement journalière ») reste à réévaluer : c'est le seul filet de rattrapage pour un bug applicatif ciblé ou une dérive de configuration GitLab, avec un délai de correction potentiel de plusieurs heures (voir [Comportement quand DB2/DRS est indisponible alors que zCX fonctionne](#comportement-quand-db2drs-est-indisponible-alors-que-zcx-fonctionne) pour le mécanisme de réconciliation lui-même).

## Conformité réglementaire à formaliser

Une analyse de conformité multi-niveaux (voir [Conformité réglementaire](conformite-reglementaire.md)) a identifié trois points à traiter formellement, indépendamment des questions déjà listées ci-dessus :

- **RTO et RPO à engager formellement** pour le service de synchronisation et sa procédure de resynchronisation, au titre de l'article 12 de DORA — priorité la plus haute de cette section, à recouper avec les lacunes déjà listées dans [Fiabilité du dispositif de mitigation](#fiabilite-du-dispositif-de-mitigation-constats-de-lanalyse-technique) ci-dessus (absence de RTO/RPO déjà notée sous l'angle technique, ici sous l'angle réglementaire).
- **Vérification à mener auprès de la fonction conformité** sur une éventuelle notification ACPR (instruction 2020-I-09) et une politique d'externalisation écrite couvrant l'usage de GitLab — non tranchée côté équipe technique, sans que cela signifie une absence de démarche menée ailleurs dans l'établissement.
- **Cartographie formelle des interdépendances** (principe n° 4 des *Principles for Operational Resilience* du Comité de Bâle, BCBS 561) reliant les opérations métier critiques à la chaîne complète de leurs dépendances techniques — non produite à ce stade.

## Politique de purge du dépôt git

Le cas de la **suppression totale d'un dépôt applicatif** (arrêt définitif d'une application, ou migration de version majeure vers une nouvelle application distincte) est désormais tranché, voir [Suppression totale d'un dépôt applicatif](perspectives.md#suppression-totale-dun-depot-applicatif) — le déclencheur est métier (gestionnaire du patrimoine applicatif) et la décision est binaire.

Reste en revanche ouvert le cas, plus technique, du dépôt qui **reste actif** : les objets Git des branches supprimées (après merge ou déploiement) y restent présents tant qu'aucun `git gc`/repack agressif n'est exécuté. Un tag créé sur le commit déployé avant suppression de la branche protège cet historique de la même façon qu'une branche, mais cela ne fait que déplacer la question :

- Faut-il interdire tout `gc`/repack agressif sur un dépôt actif, par cohérence avec la rétention "indéfinie" retenue pour l'archivage de composant (voir [Archivage des sources et load modules obsolètes](perspectives.md#archivage-des-sources-et-load-modules-obsoletes)) ?
- Qui a l'autorité pour supprimer un tag de déploiement ou déclencher une purge d'objets orphelins si la volumétrie l'impose un jour — la même autorité que pour l'archivage de composant, ou une autre instance ?

C'est un point de fragilité identifié mais non résolu à ce stade.

## Topologie du service de sync entre les deux datacenters

L'infrastructure z/OS est en haute disponibilité sur deux datacenters, ce qui couvre la panne physique (storage, [LPAR](glossaire.md#lpar) — *Logical Partition*) et la disponibilité de DB2. Reste à préciser, pour le service de synchronisation lui-même (container [zCX](glossaire.md#zcx-z-os-container-extensions) — *z/OS Container Extensions*) :

- Fonctionne-t-il en actif/actif (une instance par datacenter, toutes deux capables de traiter des webhooks) ou en actif/passif (bascule sur panne du site primaire) ?
- Si actif/actif, comment éviter qu'un même webhook GitLab soit traité en double par les deux instances (verrou distribué, bascule au niveau de l'URL du webhook côté load balancer) ?
- `SYNC_SERVICE_HEARTBEAT` (voir [Heartbeat DB2](architecture/resilience/detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)) est-il visible de façon cohérente depuis les deux sites ([data sharing](glossaire.md#data-sharing-db2) DB2), pour que la détection de panne reste fiable indépendamment du site actif ? Et surtout : sa conception actuelle (**une seule ligne**) suppose une seule instance du service — en actif/actif, les deux instances écriraient dans cette même ligne, et la mort d'un site passerait inaperçue tant que l'autre continue de pinguer. Il faudrait alors une ligne par instance (avec un identifiant de site ou d'instance), ce qui reste à concevoir si l'actif/actif est retenu.

## Correctif d'urgence pendant une panne GitLab

En mode dégradé, [USS](glossaire.md#uss-unix-system-services) (*Unix System Services*) reste strictement en lecture (voir [Résilience et synchronisation USS](architecture/resilience/index.md#la-contrainte-de-depart)) et seules les actions de [CI/CD](glossaire.md#ci-cd) (*Continuous Integration / Continuous Delivery*) (build, promotion, déploiement) sont rejouées manuellement à partir du dernier état synchronisé. Reste à clarifier le cas d'un correctif de code **urgent**, nécessaire alors que GitLab est inaccessible :

- Le mode dégradé interdit-il toute modification de code tant que GitLab n'est pas revenu (on ne fait que redéployer le dernier état connu) ?
- Ou existe-t-il une procédure de correctif d'urgence hors Git, à rejouer dans GitLab au retour de service via le [journal des actions en mode dégradé](architecture/gestion-incidents.md#mode-degrade-panne-gitlab) ?

## Sécurisation des échanges avec GitLab

L'authentification interne zCX ↔ DB2/[DRS](glossaire.md#drs-db2-rest-services) (*Db2 REST Services*) est couverte (compte technique + [PassTicket](glossaire.md#passticket) [RACF](glossaire.md#racf) (*Resource Access Control Facility*), voir [Heartbeat DB2](architecture/resilience/detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)). Mais GitLab ne parle pas RACF — deux flux externes restent à sécuriser explicitement :

- **Webhook entrant GitLab → zCX** : authentification par *secret token* GitLab (en-tête `X-Gitlab-Token`), éventuellement complétée par un allowlist IP. Sans cela, n'importe qui connaissant l'URL du webhook pourrait déclencher une resynchronisation forcée. Reste à définir où ce secret est stocké côté zCX et comment il est généré/distribué.
- **Appels sortants zCX/job de réconciliation → API GitLab** : nécessite un compte de service GitLab dédié, à scope minimal (lecture des branches/commits), avec une politique de rotation du jeton à définir.

## Accès consommateur au statut de synchro (DRS)

Le mécanisme de statut `PENDING`/`READY` sur `SYNC_STATUS` (voir [Vérification côté consommateur](architecture/resilience/detection-defauts.md#verification-cote-consommateur-verrou-de-synchro)) suppose qu'un pipeline ou un outil de packaging peut interroger DRS avant de lire un workspace USS. Reste à définir :

- Le compte technique utilisé par ce type de consommateur est-il le même compte de service que celui du service de sync (voir [Heartbeat DB2](architecture/resilience/detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)), ou un compte dédié à scope strictement en lecture sur `SYNC_STATUS` ?
- Comment ce consommateur s'authentifie-t-il auprès de DRS lorsqu'il tourne hors zCX (job batch z/OS natif, poste de développeur) — le même mécanisme PassTicket RACF s'applique-t-il, ou faut-il un canal distinct ?

Ce point conditionne directement l'adoption du verrou de synchro : sans réponse, chaque équipe consommatrice risque d'improviser son propre contournement (polling du journal, délai fixe arbitraire avant lecture) plutôt que d'utiliser le statut centralisé.

## Comportement quand DB2/DRS est indisponible alors que zCX fonctionne

Le [catalogue des pannes et conséquences](architecture/resilience/pannes-et-consequences.md#db2-ou-drs-indisponible-alors-que-zcx-fonctionne) identifie un cas distinct d'une panne zCX totale : le container de synchronisation est vivant, il reçoit bien les webhooks GitLab, mais l'écriture dans `SYNC_STATUS` échoue (DRS injoignable, verrou DB2, time-out). Si cette indisponibilité se prolonge au-delà du seuil d'alerte du heartbeat (voir [Heartbeat DB2](architecture/resilience/detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)), elle finit par être détectée comme une panne classique — le ping vers `SYNC_SERVICE_HEARTBEAT` emprunte le même canal DRS. Reste à définir le comportement pour une indisponibilité **brève**, sous ce seuil :

- Le webhook doit-il échouer volontairement (répondre un code non-2xx) pour forcer GitLab à le rejouer plus tard, une fois DB2/DRS de nouveau disponible ?
- Ou l'opération `git worktree`/`reset --hard` doit-elle malgré tout être effectuée sur USS, quitte à laisser `SYNC_STATUS` provisoirement désynchronisé pour cette branche précise — au risque de fausser le verrou de synchro côté consommateur ?

Sans réponse, ce cas risque d'être traité de façon incohérente selon l'implémentation, alors qu'il affecte directement la fiabilité du verrou de synchro qui s'appuie sur `SYNC_STATUS`.

## Détection de la saturation ou de la corruption du stockage USS

Le [catalogue des pannes et conséquences](architecture/resilience/pannes-et-consequences.md#saturation-ou-corruption-du-stockage-uss) identifie un cas où GitLab, zCX et DB2 fonctionnent tous normalement, mais l'opération de synchro échoue côté USS lui-même (disque plein sur `/u/gitlab`, corruption d'objets git, verrou [zFS](glossaire.md#zfs)). Reste à définir :

- Comment cette classe d'échec est-elle distinguée, côté supervision, d'un échec applicatif transitoire (réseau, time-out) qui se résorbe tout seul au prochain webhook ou à la prochaine réconciliation ?
- Une alerte dédiée à la santé du stockage USS (espace disque, intégrité des objets git) est-elle nécessaire en plus du heartbeat DB2, qui ne surveille que l'écriture en base et ne voit rien d'un échec purement côté fichiers ?

## Identité de l'exécutant pour les outils interactifs

Sous [ChangeMan](glossaire.md#changeman), développeurs et équipes support agissent toujours avec leurs **droits RACF (*Resource Access Control Facility*) personnels**, jamais via un utilisateur technique générique — voir [Recompilation de masse du patrimoine](perspectives.md#recompilation-de-masse-du-patrimoine). Ce principe d'imputabilité individuelle doit être repris pour les outils interactifs côté Git (recompilation de masse, prise d'image sélective), mais le mécanisme technique reste à choisir :

- **Jeton d'accès personnel GitLab** ([*Personal Access Token*](glossaire.md#personal-access-token-jeton-dacces-personnel)) généré par chaque utilisateur : simple, mais pose la question de la durée de vie et du renouvellement du jeton.
- [***Impersonation***](glossaire.md#impersonation) côté API GitLab (un compte de service agissant "pour le compte de" l'utilisateur, avec traçabilité de l'identité réelle dans les logs GitLab) : nécessite des droits d'administration élevés sur l'instance GitLab.
- **Authentification OAuth** de l'utilisateur final à chaque exécution de l'outil : la plus proche du modèle ChangeMan, mais introduit une étape interactive là où ChangeMan ne le demandait pas forcément.

Ce choix conditionne directement la capacité d'audit de ces outils — sans solution, deux développeurs partageant un même compte technique pourraient rendre une action individuellement non imputable, à l'inverse de ce que garantissait ChangeMan.

## Traçabilité de la demande d'archivage

Le déclenchement de l'archivage des sources et load modules obsolètes est porté par le gestionnaire du patrimoine applicatif (voir [Archivage des sources et load modules obsolètes](perspectives.md#archivage-des-sources-et-load-modules-obsoletes)). L'exécution technique de l'archivage sera journalisée comme le reste des opérations de cette plateforme, mais la décision elle-même — qui a demandé l'archivage de quel composant, et quand — n'a pas encore de mécanisme de traçabilité formalisé.
