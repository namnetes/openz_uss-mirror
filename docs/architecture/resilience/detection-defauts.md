# Détection et gestion des défauts de synchro

!!! info "Prérequis"
    Cette page suppose une connaissance du mécanisme décrit dans [Le service de synchronisation](service-synchronisation.md) : webhooks GitLab, cycle de vie d'une branche.

Un défaut de synchro peut se produire à trois échelles différentes, et aucun des trois mécanismes ci-dessous ne peut, seul, répondre aux trois questions à la fois :

| Mécanisme | Échelle | Question à laquelle il répond |
|---|---|---|
| Heartbeat DB2 | Le service de sync dans son ensemble | Le service est-il en vie ? |
| Réconciliation périodique | Chaque branche, à la cadence du job planifié | Le contenu USS est-il identique à GitLab ? |
| Statut consommateur (verrou) | Une branche donnée, à la demande d'un consommateur | Puis-je lire ce workspace maintenant, sans risque de lecture partielle ? |

Pour un panorama des causes possibles de défaut et de leurs conséquences concrètes, voir [Catalogue des pannes et conséquences](pannes-et-consequences.md).

## Heartbeat DB2 — détection quasi temps réel

Le service de sync écrit chaque opération dans une table **DB2 for z/OS**, via **DRS** (*Db2 REST Services* — le composant IBM qui expose les stored procedures DB2 comme endpoints REST, déjà utilisé par le reste de la plateforme), en plus du journal USS. C'est une extension du registre central déjà utilisé pour la traçabilité des packages — aucune nouvelle brique d'infrastructure, juste une table de plus et un appel DRS de plus par webhook traité.

Cet appel zCX → DRS s'authentifie avec un **compte technique** dédié, via **PassTicket** RACF (*Resource Access Control Facility*) : le secret n'est jamais stocké en clair côté zCX, puisque le PassTicket est à usage unique et généré à la demande à partir d'un secret partagé déjà connu de RACF et de DRS. Cette partie de la chaîne de sécurité — strictement interne au périmètre z/OS — est donc couverte. Ce qui reste à trancher (authentification du webhook entrant depuis GitLab, et rotation du jeton d'API GitLab utilisé par la réconciliation) est suivi dans [Points non couverts](../../points-ouverts.md#securisation-des-echanges-avec-gitlab).

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
- **Un ratio d'environ 1/3 par rapport au seuil d'alerte** (15 minutes) : c'est la pratique courante en supervision — 3 cycles de contrôle possibles avant l'alerte, une marge volontaire qui absorbe la gigue (*jitter*) normale d'un ordonnanceur batch sans provoquer de fausse alerte, tout en gardant un délai de détection raisonnable (au pire ~20 minutes : 15 minutes de seuil + jusqu'à 5 minutes avant le prochain cycle de contrôle) — négligeable comparé aux ~3h30 de fenêtre de relance GitLab dont on dispose par ailleurs pour agir (voir [Incident sur zCX](../gestion-incidents.md#incident-sur-zcx-que-se-passe-t-il-pendant-la-panne)).

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

## Vérification côté consommateur — verrou de synchro

Le heartbeat et la réconciliation répondent tous deux à *« le service de sync est-il en panne ? »*, à l'échelle du service ou d'une branche — mais aucun des deux ne protège un **consommateur** (pipeline de build, outil de packaging) contre une lecture en plein vol : le `reset --hard` du [cycle de vie d'une branche](service-synchronisation.md#cycle-de-vie-dune-branche) met à jour le workspace fichier par fichier, pas en une seule opération atomique. Un consommateur qui lit le workspace pendant que la synchro est en cours peut donc voir un mélange de fichiers anciens et nouveaux, sans qu'aucune erreur ne se produise.

`SYNC_STATUS` porte donc, en plus de l'horodatage, un **statut** qui encadre chaque opération :

- dès réception du webhook, la ligne passe à `STATUS = 'PENDING'` et `TARGET_COMMIT_HASH` est renseigné avec le commit visé ;
- une fois `git worktree add`/`fetch`/`reset --hard` terminé avec succès, la ligne passe à `STATUS = 'READY'` et `COMMIT_HASH` est aligné sur `TARGET_COMMIT_HASH`.

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

L'authentification du consommateur auprès de DRS pour cette lecture reste à définir, voir [Points non couverts](../../points-ouverts.md#acces-consommateur-au-statut-de-synchro-drs).

---

Pour la liste des causes de désynchro identifiées et leurs conséquences concrètes sur les consommateurs, voir [Catalogue des pannes et conséquences](pannes-et-consequences.md).
