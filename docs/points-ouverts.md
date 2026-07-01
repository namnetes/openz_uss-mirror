# Points non couverts

!!! warning "Page de suivi"
    Cette page recense les questions d'architecture identifiées mais non encore tranchées. Elle doit être tenue à jour au fil des décisions : une fois une question résolue, son contenu migre vers la page concernée (`architecture/resilience/`, `gestion-incidents.md`, `perspectives.md`) et l'entrée est retirée d'ici.

## Politique de purge du dépôt git

Le cas de la **suppression totale d'un dépôt applicatif** (arrêt définitif d'une application, ou migration de version majeure vers une nouvelle application distincte) est désormais tranché, voir [Suppression totale d'un dépôt applicatif](perspectives.md#suppression-totale-dun-depot-applicatif) — le déclencheur est métier (gestionnaire du patrimoine applicatif) et la décision est binaire.

Reste en revanche ouvert le cas, plus technique, du dépôt qui **reste actif** : les objets Git des branches supprimées (après merge ou déploiement) y restent présents tant qu'aucun `git gc`/repack agressif n'est exécuté. Un tag créé sur le commit déployé avant suppression de la branche protège cet historique de la même façon qu'une branche (voir échange précédent), mais ça ne fait que déplacer la question :

- Faut-il interdire tout `gc`/repack agressif sur un dépôt actif, par cohérence avec la rétention "indéfinie" retenue pour l'archivage de composant (voir [Archivage des sources et load modules obsolètes](perspectives.md#archivage-des-sources-et-load-modules-obsoletes)) ?
- Qui a l'autorité pour supprimer un tag de déploiement ou déclencher une purge d'objets orphelins si la volumétrie l'impose un jour — la même autorité que pour l'archivage de composant, ou une autre instance ?

C'est un point de fragilité identifié mais non résolu à ce stade.

## Topologie du service de sync entre les deux datacenters

L'infrastructure z/OS est en haute disponibilité sur deux datacenters, ce qui couvre la panne physique (storage, LPAR — *Logical Partition*) et la disponibilité de DB2. Reste à préciser, pour le service de synchronisation lui-même (container zCX — *z/OS Container Extensions*) :

- Fonctionne-t-il en actif/actif (une instance par datacenter, toutes deux capables de traiter des webhooks) ou en actif/passif (bascule sur panne du site primaire) ?
- Si actif/actif, comment éviter qu'un même webhook GitLab soit traité en double par les deux instances (verrou distribué, bascule au niveau de l'URL du webhook côté load balancer) ?
- `SYNC_SERVICE_HEARTBEAT` (voir [Heartbeat DB2](architecture/resilience/detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)) est-il visible de façon cohérente depuis les deux sites (data sharing DB2), pour que la détection de panne reste fiable indépendamment du site actif ? Et surtout : sa conception actuelle (**une seule ligne**) suppose une seule instance du service — en actif/actif, les deux instances écriraient dans cette même ligne, et la mort d'un site passerait inaperçue tant que l'autre continue de pinguer. Il faudrait alors une ligne par instance (avec un identifiant de site ou d'instance), ce qui reste à concevoir si l'actif/actif est retenu.

## Émergency fix pendant une panne GitLab

En mode dégradé, USS (*Unix System Services*) reste strictement en lecture (voir [Résilience et synchronisation USS](architecture/resilience/index.md#la-contrainte-de-depart)) et seules les actions de CI/CD (*Continuous Integration / Continuous Delivery*) (build, promotion, déploiement) sont rejouées manuellement à partir du dernier état synchronisé. Reste à clarifier le cas d'un correctif de code **urgent**, nécessaire alors que GitLab est inaccessible :

- Le mode dégradé interdit-il toute modification de code tant que GitLab n'est pas revenu (on ne fait que redéployer le dernier état connu) ?
- Ou existe-t-il une procédure de correctif d'urgence hors Git, à rejouer dans GitLab au retour de service via le [journal des actions en mode dégradé](architecture/gestion-incidents.md#mode-degrade-panne-gitlab) ?

## Sécurisation des échanges avec GitLab

L'authentification interne zCX ↔ DB2/DRS (*Db2 REST Services*) est couverte (compte technique + PassTicket RACF (*Resource Access Control Facility*), voir [Heartbeat DB2](architecture/resilience/detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)). Mais GitLab ne parle pas RACF — deux flux externes restent à sécuriser explicitement :

- **Webhook entrant GitLab → zCX** : authentification par *secret token* GitLab (en-tête `X-Gitlab-Token`), éventuellement complétée par un allowlist IP. Sans cela, n'importe qui connaissant l'URL du webhook pourrait déclencher une resynchronisation forcée. Reste à définir où ce secret est stocké côté zCX et comment il est généré/distribué.
- **Appels sortants zCX/job de réconciliation → API GitLab** : nécessite un compte de service GitLab dédié, à scope minimal (lecture des branches/commits), avec une politique de rotation du jeton à définir.

## Accès consommateur au statut de synchro (DRS)

Le mécanisme de statut `PENDING`/`READY` sur `SYNC_STATUS` (voir [Vérification côté consommateur](architecture/resilience/detection-defauts.md#verification-cote-consommateur-verrou-de-synchro)) suppose qu'un pipeline ou un outil de packaging peut interroger DRS avant de lire un workspace USS. Reste à définir :

- Le compte technique utilisé par ce type de consommateur est-il le même compte de service que celui du service de sync (voir [Heartbeat DB2](architecture/resilience/detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)), ou un compte dédié à scope strictement en lecture sur `SYNC_STATUS` ?
- Comment ce consommateur s'authentifie-t-il auprès de DRS lorsqu'il tourne hors zCX (job batch z/OS natif, poste de développeur) — le même mécanisme PassTicket RACF s'applique-t-il, ou faut-il un canal distinct ?

Ce point conditionne directement l'adoption du verrou de synchro : sans réponse, chaque équipe consommatrice risque d'improviser son propre contournement (polling du journal, délai fixe arbitraire avant lecture) plutôt que d'utiliser le statut centralisé.

## Comportement quand DB2/DRS est indisponible alors que zCX fonctionne

Le [catalogue des pannes et conséquences](architecture/resilience/pannes-et-consequences.md#db2-ou-drs-indisponible-alors-que-zcx-fonctionne) identifie un cas distinct d'une panne zCX totale : le container de synchronisation est vivant, il reçoit bien les webhooks GitLab, mais l'écriture dans `SYNC_STATUS` échoue (DRS injoignable, verrou DB2, timeout). Si cette indisponibilité se prolonge au-delà du seuil d'alerte du heartbeat (voir [Heartbeat DB2](architecture/resilience/detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)), elle finit par être détectée comme une panne classique — le ping vers `SYNC_SERVICE_HEARTBEAT` emprunte le même canal DRS. Reste à définir le comportement pour une indisponibilité **brève**, sous ce seuil :

- Le webhook doit-il échouer volontairement (répondre un code non-2xx) pour forcer GitLab à le rejouer plus tard, une fois DB2/DRS de nouveau disponible ?
- Ou l'opération `git worktree`/`reset --hard` doit-elle malgré tout être effectuée sur USS, quitte à laisser `SYNC_STATUS` provisoirement désynchronisé pour cette branche précise — au risque de fausser le verrou de synchro côté consommateur ?

Sans réponse, ce cas risque d'être traité de façon incohérente selon l'implémentation, alors qu'il affecte directement la fiabilité du verrou de synchro qui s'appuie sur `SYNC_STATUS`.

## Détection de la saturation ou de la corruption du stockage USS

Le [catalogue des pannes et conséquences](architecture/resilience/pannes-et-consequences.md#saturation-ou-corruption-du-stockage-uss) identifie un cas où GitLab, zCX et DB2 fonctionnent tous normalement, mais l'opération de synchro échoue côté USS lui-même (disque plein sur `/u/gitlab`, corruption d'objets git, verrou zFS). Reste à définir :

- Comment cette classe d'échec est-elle distinguée, côté supervision, d'un échec applicatif transitoire (réseau, timeout) qui se résorbe tout seul au prochain webhook ou à la prochaine réconciliation ?
- Une alerte dédiée à la santé du stockage USS (espace disque, intégrité des objets git) est-elle nécessaire en plus du heartbeat DB2, qui ne surveille que l'écriture en base et ne voit rien d'un échec purement côté fichiers ?

## Identité de l'exécutant pour les outils interactifs

Sous ChangeMan, développeurs et équipes support agissent toujours avec leurs **droits RACF (*Resource Access Control Facility*) personnels**, jamais via un utilisateur technique générique — voir [Recompilation de masse du patrimoine](perspectives.md#recompilation-de-masse-du-patrimoine). Ce principe d'imputabilité individuelle doit être repris pour les outils interactifs côté Git (recompilation de masse, prise d'image sélective), mais le mécanisme technique reste à choisir :

- **Jeton d'accès personnel GitLab** (*Personal Access Token*) généré par chaque utilisateur : simple, mais pose la question de la durée de vie et du renouvellement du jeton.
- ***Impersonation*** côté API GitLab (un compte de service agissant "pour le compte de" l'utilisateur, avec traçabilité de l'identité réelle dans les logs GitLab) : nécessite des droits d'administration élevés sur l'instance GitLab.
- **Authentification OAuth** de l'utilisateur final à chaque exécution de l'outil : la plus proche du modèle ChangeMan, mais introduit une étape interactive là où ChangeMan ne le demandait pas forcément.

Ce choix conditionne directement la capacité d'audit de ces outils — sans solution, deux développeurs partageant un même compte technique pourraient rendre une action individuellement non imputable, à l'inverse de ce que garantissait ChangeMan.

## Traçabilité de la demande d'archivage

Le déclenchement de l'archivage des sources et load modules obsolètes est porté par le gestionnaire du patrimoine applicatif (voir [Archivage des sources et load modules obsolètes](perspectives.md)). L'exécution technique de l'archivage sera journalisée comme le reste des opérations de cette plateforme, mais la décision elle-même — qui a demandé l'archivage de quel composant, et quand — n'a pas encore de mécanisme de traçabilité formalisé.
