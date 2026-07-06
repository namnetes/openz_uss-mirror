# Détection et gestion des défauts de synchro

!!! info "Prérequis"
    Cette page suppose une connaissance du mécanisme décrit dans [Le service de synchronisation](service-synchronisation.md) : webhooks GitLab, cycle de vie d'une branche. Les commandes Git utilisées ici (`status --porcelain`, `fsck`, `rev-parse`...) sont expliquées en détail, à partir de zéro, dans [Commandes Git utilisées dans ce projet](../../commandes-git.md) si elles ne vous sont pas familières.

Un défaut de synchro peut se produire à trois échelles différentes, et aucun des trois mécanismes ci-dessous ne peut, seul, répondre aux trois questions à la fois :

| Mécanisme | Échelle | Question à laquelle il répond |
|---|---|---|
| Heartbeat DB2 | Le service de sync dans son ensemble | Le service est-il en vie ? |
| Réconciliation périodique | Chaque branche, à la cadence du job planifié | Le contenu USS est-il identique à GitLab ? |
| Statut consommateur (verrou) | Une branche donnée, à la demande d'un consommateur | Puis-je lire ce workspace maintenant, sans risque de lecture partielle ? |

Pour un panorama des causes possibles de défaut et de leurs conséquences concrètes, voir [Catalogue des pannes et conséquences](pannes-et-consequences.md).

## Heartbeat DB2 — détection quasi temps réel

Le service de sync écrit chaque opération dans une table **DB2 for z/OS**, via **DRS** (*Db2 REST Services* — le composant IBM qui expose les stored procedures DB2 comme endpoints REST, déjà utilisé par le reste de la plateforme), en plus du journal USS. C'est une extension du registre central déjà utilisé pour la traçabilité des packages — aucune nouvelle brique d'infrastructure, juste une table de plus et un appel DRS de plus par webhook traité.

Cet appel zCX → DRS s'authentifie avec un **compte technique** dédié, via **PassTicket** RACF (*Resource Access Control Facility*) : le secret n'est jamais stocké en clair côté zCX, puisque le PassTicket est à usage unique et généré à la demande à partir d'un secret partagé déjà connu de RACF et de DRS. Cette partie de la chaîne de sécurité — strictement interne au périmètre z/OS — est donc couverte. Les deux flux externes avec GitLab le sont désormais aussi : l'authentification du webhook entrant (voir [Sécurisation du webhook entrant](service-synchronisation.md#securisation-du-webhook-entrant)) et l'appel sortant du job de réconciliation vers l'API GitLab (voir [Sécurisation de l'appel sortant vers l'API GitLab](#securisation-de-lappel-sortant-vers-lapi-gitlab) plus bas sur cette page).

Voici la structure de cette table :

```sql
-- Table SYNC_STATUS (une ligne par branche par application, mise à jour
-- à chaque webhook traité). APP_CODE seul ne suffit pas comme clé : chacune
-- des ~600 applications (DAxx/DYxx) possède sa propre branche "main", donc
-- BRANCH_NAME seul entrerait en collision entre applications.
CREATE TABLE SYNC_STATUS (
    APP_CODE           CHAR(4)      NOT NULL,  -- code CAPIREF, ex. 'DA12'
    BRANCH_NAME        VARCHAR(255) NOT NULL,
    LAST_EVENT_TYPE    VARCHAR(10),   -- 'CREATE' · 'PUSH' · 'DELETE'
    STATUS             VARCHAR(10)  NOT NULL,  -- 'PENDING' · 'READY'
    COMMIT_HASH        VARCHAR(40),   -- dernier commit confirmé synchronisé (STATUS = 'READY')
    TARGET_COMMIT_HASH VARCHAR(40),   -- commit visé tant que STATUS = 'PENDING'
    LAST_SYNCED_AT     TIMESTAMP NOT NULL,
    PRIMARY KEY (APP_CODE, BRANCH_NAME)
);
```

!!! warning "MAX(LAST_SYNCED_AT) ne suffit pas : il confond « service vivant » et « activité des développeurs »"
    Une première idée consiste à surveiller `MAX(LAST_SYNCED_AT)` sur `SYNC_STATUS` : tant que le service traite des webhooks, cet horodatage avance. Mais `SYNC_STATUS` n'est mis à jour **que si un développeur pousse du code** — la nuit, le week-end, ou tout simplement un jour calme, cet horodatage cesse d'avancer même si le service est parfaitement vivant. Avec un seuil de 15 minutes, cela déclencherait une **fausse alerte à chaque nuit et chaque week-end**.

    Essayer de corriger cela avec un calendrier d'activité attendue (heures ouvrées, week-ends, jours fériés) serait fragile : un séminaire ou une journée calme imprévue ne figurent dans aucun calendrier générique.

Le heartbeat repose donc sur une **table séparée**, indépendante de toute activité GitLab : le service de sync y écrit son propre signal de vie, sur son timer interne, toutes les 5 minutes — qu'il y ait ou non un webhook à traiter.

```sql
-- Une seule ligne, jamais liée à une branche ou une application :
-- ce n'est pas un état métier, seulement un signal de vie.
CREATE TABLE SYNC_SERVICE_HEARTBEAT (
    LAST_PING_AT  TIMESTAMP NOT NULL
);
```

S'il **n'avance plus** au-delà d'un seuil (ex. 15 minutes sans aucune écriture), c'est le signe que le service de sync est indisponible — indépendamment de toute activité réelle sur le patrimoine, y compris un dimanche 3h du matin :

```sql
SELECT CASE WHEN LAST_PING_AT < CURRENT TIMESTAMP - 15 MINUTES  -- (1)!
            THEN 'ALERTE — service de sync probablement down'
            ELSE 'OK' END
FROM SYNC_SERVICE_HEARTBEAT;
```

1. Seuil arbitraire, à recaler expérimentalement — mais cette fois sans dépendre du volume d'activité des développeurs, puisque le signal est émis par le service lui-même, à fréquence fixe.

**Décision retenue : un job TWS/OPC (*Tivoli Workload Scheduler* — l'ordonnanceur de traitements batch du Mainframe) en cycle répétitif toutes les 5 minutes.** TWS/OPC est avant tout conçu pour l'ordonnancement de traitements batch, pas pour du monitoring continu 24 h/24 — mais pour un contrôle aussi simple (une requête SQL), le coût d'initialisation d'un job toutes les 5 minutes reste négligeable, et cela évite d'introduire une **STC** (*Started Task* — une tâche z/OS démarrée une fois et qui tourne en continu, sans jamais se terminer) supplémentaire à surveiller elle-même, avec sa propre configuration RACF/**WLM** (*Workload Manager* — le composant z/OS qui répartit les ressources entre les traitements actifs) dédiée. Ce choix s'appuie sur un outillage déjà connu et déjà opéré par l'équipe d'exploitation, plutôt que sur un nouveau composant à faire vivre.

Le job TWS/OPC exécute la requête ci-dessus toutes les **5 minutes** — un choix qui n'est pas arbitraire, il découle de deux contraintes :

- **Pas plus fréquent que le ping du service** (lui-même toutes les 5 minutes) : entre deux pings, `LAST_PING_AT` ne change pas — vérifier plus souvent ne donnerait aucune information supplémentaire, seulement des lancements de job superflus.
- **Un ratio d'environ 1/3 par rapport au seuil d'alerte** (15 minutes) : c'est la pratique courante en supervision — 3 cycles de contrôle possibles avant l'alerte, une marge volontaire qui absorbe la gigue (*jitter*) normale d'un ordonnanceur batch sans provoquer de fausse alerte, tout en gardant un délai de détection raisonnable (au pire ~20 minutes : 15 minutes de seuil + jusqu'à 5 minutes avant le prochain cycle de contrôle) — négligeable comparé aux ~3h36 de fenêtre de relance GitLab dont on dispose par ailleurs pour agir (voir [Incident sur zCX](../gestion-incidents.md#incident-sur-zcx-que-se-passe-t-il-pendant-la-panne)).

Un intervalle plus court (1-2 minutes) multiplierait les lancements de job sans gain réel de détection ; un intervalle plus long (10-15 minutes) réduirait la marge de sécurité — un seul cycle retardé suffirait alors à repousser la détection à 30-45 minutes.

En cas d'`ALERTE`, le job notifie par messagerie la **BAL** (*boîte aux lettres*) **de l'équipe d'administration** et la liste de diffusion **`LCL_SNI_SQUAD_SAM`** — les deux destinataires du canal d'alerte pour ce composant.

`SYNC_STATUS` (et son `MAX(LAST_SYNCED_AT)`) reste utile pour autre chose : savoir **quand a eu lieu la dernière activité réelle** sur le patrimoine — une information opérationnelle différente de "le service est-il vivant".

!!! info "Pas besoin d'index sur LAST_SYNCED_AT"
    `SYNC_STATUS` n'est pas un journal qui grossit indéfiniment : c'est une table à **une ligne par branche active** (`PRIMARY KEY (APP_CODE, BRANCH_NAME)`), mise à jour en place à chaque webhook, jamais en ajout. Avec ~600 applications et quelques branches actives chacune, la table reste bornée à quelques milliers de lignes — un `SELECT MAX(LAST_SYNCED_AT)` en scan complet s'exécute en quelques millisecondes, sans index dédié.

    Un index deviendrait pertinent si `SYNC_STATUS` changeait de nature (un journal *append-only* de tout l'historique des synchros plutôt qu'un état courant par branche) — ce qui n'est pas le design retenu ici. À noter aussi qu'un `MAX()` ne nécessite pas spécifiquement un index **descendant** : un index B-tree ascendant permet tout autant de lire directement la valeur extrême sans scanner le reste.

Ce heartbeat prouve que le service **tourne**, pas qu'il traite correctement **chaque** événement, ni que USS est réellement identique à GitLab : un événement perdu côté GitLab au-delà des relances, ou un bug ciblé sur une branche précise (voir [Catalogue des pannes et conséquences](pannes-et-consequences.md#bug-applicatif-cible-sur-une-branche)), peuvent très bien coexister avec un signal de vie parfaitement frais. C'est pour cette vérification de fond que la réconciliation périodique reste nécessaire, mais à une cadence plus légère puisque le cas le plus urgent — le service est-il en vie ? — est désormais couvert en continu, sans job dédié.

## Réconciliation périodique

Le webhook garantit la sync en temps réel, et le heartbeat DB2 détecte une panne du service en moins de 20 minutes — mais ni l'un ni l'autre ne sait si un événement a été **perdu côté GitLab** au-delà des relances. Un **job z/OS planifié** exécute la même logique que la [resynchronisation complète](../gestion-incidents.md#resynchronisation-complete) décrite dans la page dédiée à la gestion des incidents : il part de la liste des branches GitLab (source de vérité, récupérée en mode paginé) et la confronte à l'état connu en DB2 (et, ponctuellement, à l'état réel des workspaces USS).

Ce balayage couvre les **quatre cas** possibles, pas seulement le retard de commits :

- branche GitLab sans workspace USS correspondant (ex. webhook de création perdu) ;
- workspace USS en retard sur GitLab (ex. webhook de push perdu) ;
- workspace USS à jour (aucune action) ;
- workspace USS orphelin, dont la branche GitLab a été supprimée (ex. webhook de suppression perdu).

!!! info "Pourquoi comparer les hash plutôt que les horodatages"
    Une comparaison par horodatage (`LAST_SYNCED_AT` en DB2 vs date du dernier push GitLab) semble plus simple que la comparaison de hash, mais laisse passer des cas que seul le hash capture :

    - **Absence de ligne DB2** (webhook de création perdu) : il n'y a rien à comparer — l'absence d'une ligne n'est pas un horodatage périmé.
    - **Workspace orphelin** (webhook de suppression perdu) : la branche a disparu de GitLab, donc plus aucun horodatage GitLab en face à comparer — seule la liste des branches encore existantes révèle l'orphelin.
    - **Écriture DB2 réussie mais opération git échouée juste après** (panne réseau, erreur git) : `LAST_SYNCED_AT` est à jour alors que USS est resté sur l'ancien commit — le timestamp ment, le hash non.
    - **Dérive d'horloge** entre GitLab (hors périmètre z/OS) et DB2 : comparer deux horodatages absolus entre deux systèmes indépendants suppose une synchronisation NTP (*Network Time Protocol*) fiable des deux côtés ; le hash, lui, est insensible à toute dérive d'horloge.

    Enfin, l'appel API GitLab qui donnerait l'horodatage du dernier commit d'une branche renvoie de toute façon son hash dans la même réponse — comparer le hash n'a donc **aucun surcoût** par rapport à un horodatage, tout en étant strictement plus fiable puisqu'il prouve l'identité du contenu et non une simple notion de fraîcheur.

Sa cadence peut désormais être **plus légère qu'auparavant** (ex. une fois par jour plutôt que toutes les heures) : le cas le plus urgent — le service de sync est-il en vie ? — est déjà couvert en continu par le heartbeat DB2. Ce job ne reste nécessaire que pour le cas résiduel, plus rare, d'un événement réellement perdu côté GitLab malgré un service de sync disponible.

En cas de divergence, le job journalise l'écart, déclenche une alerte vers l'équipe d'exploitation (canal de supervision z/OS existant) et lance automatiquement la resynchronisation complète sur les branches concernées — sans attendre d'intervention manuelle.

### Sécurisation de l'appel sortant vers l'API GitLab

Le webhook entrant s'authentifie par un secret que GitLab nous envoie (voir [Sécurisation du webhook entrant](service-synchronisation.md#securisation-du-webhook-entrant)). Ici c'est l'inverse : le job de réconciliation appelle l'API GitLab, et doit donc lui **présenter** un jeton que GitLab reconnaît.

**Compte et scope retenus** : un jeton rattaché à un **compte de service GitLab dédié** (bot), jamais un jeton personnel — cohérent avec le principe d'imputabilité individuelle déjà posé ailleurs dans ce projet (voir [Identité de l'exécutant](../../perspectives.md#recompilation-de-masse-du-patrimoine)), qui ne s'applique pas ici puisqu'il s'agit d'un processus automatisé, pas d'une action humaine. Scope minimal, en **lecture seule** (branches/commits) : ce jeton ne doit jamais pouvoir écrire quoi que ce soit sur GitLab.

**Stockage** : une nouvelle table DB2, distincte de `SYNC_WEBHOOK_SECRET`, avec un GRANT restreint au seul compte technique du job de réconciliation — une fuite d'un composant ne doit pas donner accès aux secrets de l'autre (séparation des privilèges). Contrairement au secret webhook, vérifié par simple égalité et donc stocké sous forme de hash, ce jeton doit être **récupérable en clair** pour être présenté à GitLab : il est donc chiffré au repos via **ICSF** (*Integrated Cryptographic Service Facility* — le service z/OS natif de cryptographie matérielle, déjà présent sur ce type de plateforme, donc aucune nouvelle brique d'infrastructure), avec une clé de chiffrement elle-même protégée par RACF, et déchiffré en mémoire seulement au moment de l'appel.

```sql
-- Une seule ligne : le jeton API GitLab est un paramètre du service, pas un
-- état métier par branche (même esprit que SYNC_WEBHOOK_SECRET).
CREATE TABLE SYNC_GITLAB_API_TOKEN (
    TOKEN_ENCRYPTED  VARCHAR(512) NOT NULL,  -- jeton chiffré via ICSF, jamais en clair en base
    EXPIRES_AT       TIMESTAMP NOT NULL,      -- échéance déclarée côté GitLab à la création du jeton
    ROTATED_AT       TIMESTAMP NOT NULL
);
```

!!! warning "L'expiration est obligatoire, indépendamment de ce que GitLab impose par défaut"
    L'instance GitLab de la plateforme n'impose pas nécessairement une expiration par défaut sur ce type de jeton (un jeton personnel classique peut très bien ne jamais expirer). Ce n'est pas une raison suffisante pour un jeton qui vit dans une base de données, jamais entre les mains d'un humain, sur un SI bancaire critique : l'expiration est fixée explicitement à chaque création de jeton, comme **décision organisationnelle**, pas comme contrainte technique subie. Cadence retenue : **90 jours**.

Le vrai risque n'est pas l'expiration elle-même, mais une expiration **non anticipée** : sans surveillance, un jeton qui expire un jour donné transforme un simple renouvellement de routine en panne de production. Le job TWS/OPC qui sonde déjà `SYNC_SERVICE_HEARTBEAT` toutes les 5 minutes (voir [Heartbeat DB2](#heartbeat-db2-detection-quasi-temps-reel)) étend son contrôle à `EXPIRES_AT` :

```sql
SELECT CASE WHEN EXPIRES_AT < CURRENT TIMESTAMP + 15 DAYS
            THEN 'ALERTE — jeton API GitLab arrive à expiration'
            ELSE 'OK' END
FROM SYNC_GITLAB_API_TOKEN;
```

Un seuil de **15 jours avant échéance** laisse une marge confortable pour une rotation manuelle, sans dépendre d'un outil de suivi centralisé des secrets/certificats — aucun n'existe à ce jour à l'échelle de l'entreprise pour ce type de jeton applicatif. Même canal d'alerte que le heartbeat (BAL de l'équipe d'administration et liste `LCL_SNI_SQUAD_SAM`) : pas de nouveau canal à créer.

!!! info "Distinguer un jeton expiré d'une panne GitLab"
    Un jeton expiré ou révoqué fait échouer l'appel API du job de réconciliation avec un code d'erreur d'authentification (401/403) — un signal précis, différent d'un timeout ou d'une erreur réseau qui indiquerait une véritable panne GitLab (voir [Catalogue des pannes et conséquences](pannes-et-consequences.md)). Le job de réconciliation distingue explicitement ces deux cas dans son propre message d'alerte, pour éviter qu'un opérateur ne perde du temps à diagnostiquer une panne GitLab qui n'est en réalité qu'un jeton à renouveler.

**Rotation** : manuelle, tous les 90 jours ou dès l'alerte à J-15 — un opérateur habilité crée le nouveau jeton dans GitLab (scope et échéance explicites), chiffre et insère la nouvelle valeur via le canal DRS existant, révoque l'ancien jeton une fois le basculement confirmé. Automatiser resterait disproportionné pour un jeton en lecture seule : il faudrait un jeton encore plus privilégié pour piloter la rotation par API GitLab, ce qui ne ferait que déplacer le problème vers un secret plus sensible à protéger.

## Vérification côté consommateur — verrou de synchro

Le heartbeat et la réconciliation répondent tous deux à *« le service de sync est-il en panne ? »*, à l'échelle du service ou d'une branche — mais aucun des deux ne protège un **consommateur** (pipeline de build, outil de packaging) contre une lecture en plein vol : le [`reset --hard`](../../commandes-git.md#reset-hard-une-commande-destructive-volontairement) du [cycle de vie d'une branche](service-synchronisation.md#cycle-de-vie-dune-branche) met à jour le workspace fichier par fichier, pas en une seule opération atomique. Un consommateur qui lit le workspace pendant que la synchro est en cours peut donc voir un mélange de fichiers anciens et nouveaux, sans qu'aucune erreur ne se produise.

`SYNC_STATUS` porte donc, en plus de l'horodatage, un **statut** qui encadre chaque opération :

- dès réception du webhook, la ligne passe à `STATUS = 'PENDING'` et `TARGET_COMMIT_HASH` est renseigné avec le commit visé ;
- une fois [`git worktree add`](../../commandes-git.md#worktree-plusieurs-repertoires-de-travail-pour-un-seul-depot)/[`fetch`](../../commandes-git.md#les-commandes-de-base-deja-connues)/`reset --hard` terminé avec succès, la ligne passe à `STATUS = 'READY'` et `COMMIT_HASH` est aligné sur `TARGET_COMMIT_HASH`.

Avant de lire un workspace, un consommateur interroge cette même table via DRS :

```sql
SELECT STATUS FROM SYNC_STATUS
WHERE APP_CODE = 'DA12' AND BRANCH_NAME = 'pkg/PKG-20260616-0042';
-- READY   → lecture autorisée, contenu stable
-- PENDING → synchro en cours, attendre ou réessayer
```

!!! warning "READY ne doit être posé qu'après un reset --hard intégralement terminé"
    Si `STATUS` passe à `READY` avant que le dernier fichier soit réellement à jour sur USS (write en cache non flush, par exemple), un consommateur peut de nouveau lire un état partiel — exactement le problème que ce statut est censé éliminer. L'écriture de `READY` doit donc être la toute dernière étape de l'opération de sync, après confirmation que le filesystem a bien matérialisé le `reset --hard`.

Un `STATUS = 'PENDING'` qui ne repasse pas à `READY` au-delà d'un seuil (le même principe que le heartbeat, ex. 15 minutes) signale un service de sync mort en cours d'opération sur cette branche précise — à traiter par la même alerte de supervision, sans mécanisme dédié supplémentaire.

!!! note "Le consommateur peut vérifier la fraîcheur en plus du statut — en complément, pas à la place de la supervision"
    Un consommateur pourrait être tenté d'interroger lui-même `SYNC_SERVICE_HEARTBEAT` (voir [Heartbeat DB2](#heartbeat-db2-detection-quasi-temps-reel)) avant de lire, plutôt que de s'en remettre à la supervision centrale. Cela reste une bonne pratique **en complément** — une seconde ligne de défense qui protège le consommateur même si une alerte d'exploitation a été manquée ou tarde à être traitée. Mais cela ne peut pas **remplacer** le heartbeat centralisé : la détection ne se déclencherait alors que lorsqu'un consommateur cherche effectivement à lire — si aucun pipeline ne tourne sur une application donnée pendant un week-end, personne ne vérifie rien, et un service mort passerait inaperçu jusqu'au retour d'activité. C'est exactement la même faille que celle du heartbeat basé sur `SYNC_STATUS` (voir plus haut), seulement déplacée de "l'activité des développeurs" vers "l'activité des consommateurs". Le heartbeat centralisé reste donc indispensable pour l'alerte proactive de l'exploitation ; la vérification côté consommateur n'est qu'une garantie supplémentaire au moment de la lecture.

### Authentification du consommateur auprès de DRS

Deux cas distincts, selon que le consommateur tourne ou non dans le périmètre z/OS natif :

**Job batch z/OS natif** : il n'a pas besoin de DRS du tout. DRS n'a de valeur que pour un appelant qui, comme zCX, ne peut pas parler nativement à DB2 (voir [Où stocker ce secret côté zCX](service-synchronisation.md#ou-stocker-ce-secret-cote-zcx) pour ce constat côté zCX) — un job batch natif, lui, est déjà dans le périmètre RACF/DB2 de confiance et peut se connecter en SQL natif, avec sa propre identité RACF et un GRANT DB2 classique. Ajouter un saut REST via DRS n'apporterait rien ici, seulement une latence et un composant de plus à opérer.

**Poste de développeur (ou tout appelant hors z/OS)** : à l'inverse, ce cas est en tout point identique à celui de zCX → DRS — un appelant externe au périmètre z/OS natif, qui doit donc emprunter le même canal DRS et le même mécanisme d'authentification par PassTicket RACF (voir [Heartbeat DB2](#heartbeat-db2-detection-quasi-temps-reel)), sans inventer de canal distinct pour ce seul cas.

**Décision retenue : ce projet expose un mécanisme en lecture seule — le canal DRS, avec un GRANT strictement `SELECT` sur `SYNC_STATUS` — distinct de celui du service de sync, sans être responsable de la gestion des habilitations de chaque consommateur.** Cohérent avec le principe de séparation des privilèges déjà retenu pour `SYNC_GITLAB_API_TOKEN` (voir [Sécurisation de l'appel sortant vers l'API GitLab](#securisation-de-lappel-sortant-vers-lapi-gitlab)) : le compte du service de sync a besoin d'écrire `SYNC_STATUS` (`PENDING`/`READY`), ce qu'aucun accès exposé à un consommateur ne doit jamais permettre — une fuite ou un mésusage côté pipeline de build ne doit pas pouvoir corrompre le verrou de synchro dont dépendent tous les autres consommateurs.

Qui obtient ce GRANT, sous quel compte, et comment ce compte est provisionné et renouvelé relève de chaque équipe consommatrice et de sa propre gouvernance d'accès — pas de ce projet (voir [Périmètre du projet et responsabilités](../index.md#acces-en-lecture-des-consommateurs)). Ce que ce projet garantit, c'est seulement la nature du canal exposé — strictement `SELECT` sur `SYNC_STATUS`, quel que soit le compte qui l'emprunte — pas la liste des comptes autorisés à s'en servir. L'imputabilité individuelle, centrale pour une action qui *modifie* quelque chose (voir [Identité de l'exécutant](../../perspectives.md#recompilation-de-masse-du-patrimoine)), n'a de toute façon pas la même portée ici : consulter un statut avant lecture ne modifie rien et n'engage aucune responsabilité individuelle à tracer.

### Vérification de la propreté (intégrité du contenu)

`SYNC_STATUS` répond à *« ce workspace est-il synchro ? »* (fraîcheur) — pas à *« ce workspace est-il propre ? »* (intégrité du contenu), voir [Périmètre du projet et responsabilités](../index.md#acces-en-lecture-des-consommateurs). La [réconciliation périodique](#reconciliation-periodique) s'en approche, mais ne compare que le hash de `HEAD` — une référence, pas le contenu réel des fichiers — et seulement à sa propre cadence, jamais à l'appel d'un consommateur précis juste avant une lecture. Une corruption survenue *après* un `STATUS = READY` déjà posé (corruption zFS, écriture inattendue) ne serait donc détectée qu'au prochain cycle de réconciliation.

**Décision retenue : aucune nouvelle brique d'infrastructure — le consommateur vérifie lui-même la propreté, localement, avec [`git status --porcelain`](../../commandes-git.md#les-commandes-de-base-deja-connues).**

Le raisonnement tient à une seule observation : USS est strictement en lecture en dehors d'une opération de synchro (voir [La contrainte de départ](../resilience/index.md#la-contrainte-de-depart)) — rien ni personne n'est censé modifier un fichier d'un workspace entre deux `reset --hard` du service de sync. Toute divergence entre les fichiers réellement présents sur disque et ce que git a enregistré au dernier `reset --hard` — qu'elle vienne d'une corruption zFS ou d'une écriture non autorisée, peu importe la cause — est donc par construction une anomalie à détecter. C'est exactement ce que `git status`/[`git diff`](../../commandes-git.md#les-commandes-de-base-deja-connues) savent déjà faire nativement, sans aucun nouveau composant :

```bash
git -C <workspace> status --porcelain
# Sortie vide  → workspace propre, lecture fiable
# Toute ligne  → fichier modifié, supprimé ou inattendu (untracked) : anomalie
```

Une sortie non vide doit être traitée avec la même sévérité qu'un `SYNC_STATUS` resté bloqué à `PENDING` (voir plus haut) : le consommateur refuse la lecture, l'anomalie remonte à la même supervision, et une [resynchronisation complète](../gestion-incidents.md#resynchronisation-complete) de cette branche précise est déclenchée — sans nouveau canal d'alerte à créer.

!!! info "Pourquoi ce contrôle reste bon marché"
    Git ne recalcule le hash d'un fichier que si son `mtime`/sa taille en cache diffère de ce qu'il a enregistré — pour un workspace réellement inchangé depuis le dernier `reset --hard` (le cas normal, l'immense majorité des lectures), la vérification se limite à un `stat()` par fichier suivi, pas une relecture de contenu. Le coût ne monte au recalcul complet que précisément quand quelque chose a changé — exactement le cas où ce coût supplémentaire est justifié.

    Deux alternatives, écartées pour cette raison :

    - [**`git fsck`**](../../commandes-git.md#linterieur-de-git-object-store-purge-integrite) vérifie l'intégrité de la base d'objets entière (`repo/`, partagée par tous les workspaces d'une même application, voir [Les workspaces USS](../resilience/index.md#les-workspaces-uss-une-branche-un-repertoire)), pas seulement les fichiers d'une branche — bien plus coûteux, et redondant à exécuter à chaque lecture d'un consommateur qui ne s'intéresse qu'à sa propre branche.
    - **Un recalcul de hash "à la main"** (en dehors de git) relirait systématiquement chaque fichier intégralement à chaque lecture — annulant précisément l'optimisation de cache stat que `git status` offre déjà nativement.

Cette même vérification peut enrichir la réconciliation périodique elle-même (ajouter un `git status --porcelain` par branche à la comparaison de hash déjà en place), pour couvrir aussi une corruption qui laisserait `HEAD` inchangé — un raffinement du mécanisme existant, pas une nouvelle brique à opérer.

---

Pour la liste des causes de désynchro identifiées et leurs conséquences concrètes sur les consommateurs, voir [Catalogue des pannes et conséquences](pannes-et-consequences.md).
