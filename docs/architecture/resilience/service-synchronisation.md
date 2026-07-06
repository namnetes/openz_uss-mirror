# Le service de synchronisation

!!! info "Prérequis"
    Cette page suppose une connaissance de [La contrainte de départ et les workspaces USS](index.md). Les commandes Git utilisées ici (`fetch`, `reset --hard`, `worktree`...) sont expliquées en détail, à partir de zéro, dans [Commandes Git utilisées dans ce projet](../../commandes-git.md) si elles ne vous sont pas familières.

La synchronisation est **découplée du pipeline de build**. Un pipeline peut être annulé, échouer ou être manuellement ignoré — la sync USS doit se produire quoi qu'il arrive.

Le service de sync est un composant dédié qui tourne dans un container **zCX** (*z/OS Container Extensions* — la technologie qui permet de faire tourner des containers Linux sur z/OS) et réagit aux **webhooks GitLab** : des notifications HTTP que GitLab envoie sur chaque événement de dépôt, indépendamment de tout pipeline.

!!! info "Le webhook se déclenche quel que soit le canal utilisé par le développeur"
    Le webhook est émis **côté serveur GitLab**, sur l'événement de dépôt lui-même (un nouveau commit existe, une branche est créée ou supprimée) — pas sur le client qui a produit cet événement. Le résultat est donc identique que le développeur :

    - pousse en CLI via [`git push`](../../commandes-git.md#les-commandes-de-base-deja-connues) depuis son poste ou un accès distant (VPN, bastion) ;
    - commite directement depuis l'interface web de GitLab (Web IDE, édition de fichier en ligne) ;
    - crée ou supprime une branche depuis l'interface graphique GitLab ;
    - déclenche l'action via l'API REST GitLab.

    Dans tous ces cas, GitLab produit le même événement serveur (`push`, `create`, `delete`) et émet le même webhook vers le service de sync. La résilience décrite dans cette section (relances automatiques, heartbeat DB2, réconciliation périodique) s'applique donc indépendamment du canal d'accès au dépôt.

!!! info "Comment GitLab détecte qu'un webhook a échoué"
    GitLab ne sonde pas activement la disponibilité du service de sync : il le découvre **au moment où il essaie réellement de livrer un événement**. Le service doit répondre par un code HTTP **2xx** dans un délai limité (~10 secondes) ; tout code 4xx/5xx, time-out ou refus de connexion est considéré comme un échec et déclenche le calendrier de relance (1 min, 5 min, 10 min, 100 min, 100 min). Chaque tentative — code retour inclus — est consultable dans GitLab via *Settings → Webhooks → Edit → Recent Deliveries*, avec un bouton `Resend` pour rejouer manuellement.

    C'est donc un mécanisme de détection **par événement**, pas un heartbeat continu : si aucune branche n'est touchée pendant la panne, GitLab ne "voit" pas le service de sync indisponible. C'est le rôle du **heartbeat DB2** (voir [Détection et gestion des défauts de synchro](detection-defauts.md)) de combler ce trou en quasi temps réel, sans attendre un événement GitLab ni un job planifié.

## Vue d'ensemble

Le schéma suivant résume les acteurs et échanges du mécanisme :

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#ffffff"}}}%%
flowchart TD
    Dev([Développeur]):::startStop
    Conso([Pipeline / outil\nconsommateur]):::startStop

    subgraph OPEN["Infrastructure ouverte"]
        GitLab[[GitLab\nDépôt source]]:::external
    end

    subgraph ZCX["zCX — z/OS Container Extensions"]
        SyncSvc[Service de sync\nWebhook receiver]:::logic
    end

    subgraph ZOS["z/OS natif"]
        USS[/USS Workspaces\ngit worktree par branche/]:::data
        DB2[(DB2 for z/OS\nSYNC_STATUS ·\nSYNC_SERVICE_HEARTBEAT)]:::data
        Recon[Job de réconciliation\nz/OS planifié]:::logic
        Superv[Job TWS/OPC\ncycle 5 min]:::logic
    end

    Dev -->|push CLI · Web IDE · UI · API| GitLab
    GitLab -->|webhook HTTP| SyncSvc
    SyncSvc -->|git worktree\nadd · sync · remove| USS
    SyncSvc -->|écrit état sync + ping\nvia DRS| DB2
    Superv -->|sonde\nSYNC_SERVICE_HEARTBEAT| DB2
    Recon -->|compare hashes| GitLab
    Recon -->|remédiation si écart| USS
    Conso -->|vérifie STATUS| DB2
    Conso -->|lit sources si READY| USS

    classDef startStop fill:#e1f5fe,stroke:#01579b,color:#000
    classDef logic     fill:#e8eaf6,stroke:#1a237e,color:#000
    classDef data      fill:#fff3e0,stroke:#e65100,color:#000
    classDef external  fill:#f3e5f5,stroke:#6a1b9a,color:#000

    subgraph Legend["Légende"]
        direction LR
        L1([Utilisateur]):::startStop
        L2[Traitement]:::logic
        L3[/Données · Fichiers/]:::data
        L5[(Base de données)]:::data
        L4[[Service externe]]:::external
    end
```

Ce diagramme se lit de gauche à droite : le développeur agit sur GitLab (quel que soit le canal), GitLab notifie le service de sync par webhook, qui met à jour à la fois USS (les sources) et DB2 (l'état de la synchro, plus son propre signal de vie) via **DRS** (*Db2 REST Services* — l'interface qui expose DB2 sous forme d'appels API REST) ; un job **TWS/OPC** (*Tivoli Workload Scheduler* — l'ordonnanceur de traitements batch du Mainframe) sonde ce signal de vie toutes les 5 minutes, indépendamment de toute activité ; le job de réconciliation vérifie périodiquement la cohérence entre GitLab, DB2 et USS ; un consommateur (pipeline, outil de packaging) vérifie le statut en DB2 avant de lire les sources sur USS — voir [Détection et gestion des défauts de synchro](detection-defauts.md).

## Sécurisation du webhook entrant

Contrairement à l'appel zCX → DRS ([Heartbeat DB2](detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)), strictement interne au périmètre z/OS et couvert par un PassTicket RACF, le webhook entrant traverse la frontière avec GitLab — une infrastructure qui ne parle pas RACF. Sans protection, n'importe qui connaissant l'URL du webhook pourrait déclencher une resynchronisation forcée sur n'importe quelle branche.

GitLab propose un mécanisme natif pour cela : un **secret token**, configuré une fois dans les paramètres du webhook (*Settings → Webhooks*), renvoyé tel quel dans l'en-tête HTTP `X-Gitlab-Token` à chaque appel. Le service de sync doit vérifier cet en-tête avant de traiter quoi que ce soit d'autre.

### Où stocker ce secret côté zCX

zCX exécute des containers Linux dans un environnement isolé du z/OS natif : le code applicatif à l'intérieur d'un container ne peut pas appeler directement les services RACF/SAF (RACROUTE) comme le ferait un programme natif z/OS. La seule chaîne d'authentification RACF déjà éprouvée pour ce container précis est celle utilisée pour DB2/DRS (compte technique + PassTicket, voir [Heartbeat DB2](detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)) — c'est ce canal qu'on réutilise, plutôt que d'introduire un second mécanisme différent pour ce seul secret.

zCX permet aussi de monter un dataset MVS protégé RACF via NFS, mais cette autorisation s'applique alors à l'ensemble de l'appliance zCX (un seul certificat client pour tout le trafic NFS de l'appliance) — une granularité plus grossière que l'appel DRS, scopé au container qui héberge le service de sync. Réutiliser DRS garde donc une isolation plus fine, sans nouveau composant à opérer.

**Décision retenue : une nouvelle table DB2, protégée exactement comme `SYNC_STATUS` et `SYNC_SERVICE_HEARTBEAT` (GRANT DB2 + RACF), accédée via ce même canal DRS.**

```sql
-- Une seule ligne : le secret webhook est un paramètre du service, pas un
-- état métier par branche (même esprit que SYNC_SERVICE_HEARTBEAT).
CREATE TABLE SYNC_WEBHOOK_SECRET (
    SECRET_HASH  VARCHAR(64) NOT NULL,  -- SHA-256 du secret, jamais le secret en clair
    ROTATED_AT   TIMESTAMP NOT NULL
);
```

!!! info "Pourquoi un hash plutôt que le secret en clair"
    Vérifier un webhook ne demande pas de connaître le secret, seulement de savoir si deux valeurs sont égales — exactement le même besoin qu'une vérification de mot de passe. Stocker une empreinte **SHA-256** (*Secure Hash Algorithm* — une fonction qui transforme n'importe quelle valeur en une empreinte de taille fixe, impossible à inverser en pratique) plutôt que le secret en clair évite qu'une fuite de la table (sauvegarde mal protégée, GRANT trop large) ne rende le vrai secret exploitable. La vérification compare le hash de la valeur reçue (`X-Gitlab-Token`) au hash stocké — jamais le secret lui-même.

Au démarrage, le service de sync récupère `SECRET_HASH` via DRS (même compte technique, même PassTicket que pour le heartbeat) et le garde en mémoire ; il ne l'écrit jamais sur disque dans le container. Un rafraîchissement périodique (ou déclenché par un échec de vérification) permet de prendre en compte une rotation sans redémarrer le container.

### Génération et rotation

- **Génération** : un secret aléatoire suffisamment long (ex. 32 octets, `openssl rand -hex 32`), généré une fois par un opérateur habilité.
- **Distribution** : saisi manuellement dans GitLab (*Settings → Webhooks → Secret token* — GitLab ne le réaffiche plus en clair une fois saisi), et son empreinte SHA-256 inséré dans `SYNC_WEBHOOK_SECRET` via le canal DRS existant, dans la même opération de provisionnement.
- **Rotation** : la cadence reste à définir. Le jeton de service utilisé par la réconciliation pour appeler l'API GitLab suit un schéma voisin mais distinct (rotation à échéance fixe plutôt qu'à définir) — voir [Sécurisation de l'appel sortant vers l'API GitLab](detection-defauts.md#securisation-de-lappel-sortant-vers-lapi-gitlab).
- **Défense complémentaire** : un allowlist IP (adresses connues des relais GitLab) reste une option en plus du secret token, pas un substitut.

## Cycle de vie d'une branche

Un nom de branche GitLab peut contenir des `/` — quelle que soit la convention de nommage utilisée par l'équipe (`pkg/PKG-20260616-0042`, `DAY1000001/features-demo`, etc.). Or chaque workspace USS est un répertoire **à plat** : un `/` y serait interprété comme un séparateur de chemin et créerait des sous-répertoires non désirés plutôt qu'un seul workspace.

Le service de sync convertit donc systématiquement **chaque `/` du nom de branche en `-`** pour construire le nom du répertoire workspace, quel que soit le nombre ou la position de ces `/` :

- `pkg/PKG-20260616-0042` (application `DA12`) → `/u/gitlab/DA12/workspaces/pkg-PKG-20260616-0042`
- `DAY1000001/features-demo` (application `DY07`) → `/u/gitlab/DY07/workspaces/DAY1000001-features-demo`

Une fois cette conversion appliquée, le service de sync réagit à trois types d'événements GitLab :

| Événement GitLab | Action USS |
|---|---|
| Création de branche `pkg/...` | [`git worktree add /u/gitlab/<app>/workspaces/<branche-converti> <branche>`](../../commandes-git.md#worktree-plusieurs-repertoires-de-travail-pour-un-seul-depot) |
| Push (commit) sur la branche | `git -C /u/gitlab/<app>/workspaces/<branche-converti> fetch && git -C /u/gitlab/<app>/workspaces/<branche-converti> reset --hard origin/<branche>` |
| Suppression de branche (après merge) | [`git worktree remove /u/gitlab/<app>/workspaces/<branche-converti>`](../../commandes-git.md#worktree-plusieurs-repertoires-de-travail-pour-un-seul-depot) |

!!! info "Pour qui découvre Git : que font `fetch` et `reset --hard` ?"
    Deux commandes distinctes, deux rôles différents :

    - [**`git fetch`**](../../commandes-git.md#les-commandes-de-base-deja-connues) télécharge depuis GitLab (appelé `origin`) les nouveaux commits qui n'existent pas encore localement — mais **ne touche à aucun fichier** du workspace. C'est une mise à jour de la connaissance de l'historique, invisible tant qu'on ne l'exploite pas explicitement : après un `fetch`, les fichiers sur disque sont encore exactement comme avant.
    - [**`git reset --hard <commit>`**](../../commandes-git.md#reset-hard-une-commande-destructive-volontairement) force ensuite les fichiers du workspace à correspondre **exactement** à ce commit précis, en écrasant sans avertissement tout ce qui s'y trouvait avant. C'est une opération destructive par nature — n'importe quelle modification locale non commitée serait perdue.

    Cet enchaînement `fetch` puis `reset --hard` (plutôt qu'un [`git pull`](../../commandes-git.md#les-commandes-de-base-deja-connues), qui aurait fusionné les changements au lieu de les imposer) est **volontairement écrasant** ici, et c'est précisément ce qui convient : USS est un miroir en lecture seule (voir [La contrainte de départ](index.md#la-contrainte-de-depart)), il n'y a donc jamais de "travail en cours" sur ces fichiers qu'on risquerait de perdre — contrairement à un poste de développeur, où ces mêmes commandes seraient dangereuses à utiliser sans précaution.

Le tableau ci-dessus montre *quelle* action correspond à *quel* événement, mais pas *dans quel ordre* les étapes s'enchaînent pour un même événement — en particulier l'ordre entre l'écriture du statut en DB2 et l'opération git sur USS, déjà signalé comme critique dans [Vérification côté consommateur](detection-defauts.md#verification-cote-consommateur-verrou-de-synchro). Le diagramme de séquence suivant détaille ce déroulé pour un `PUSH` :

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#ffffff"}}}%%
sequenceDiagram
    actor Dev as Développeur
    participant GitLab
    participant SyncSvc as Service de sync (zCX)
    participant DB2 as DB2 (SYNC_STATUS)
    participant USS

    Dev->>GitLab: git push (nouveau commit)
    GitLab->>SyncSvc: webhook HTTP (push, commit_hash)<br/>en-tête X-Gitlab-Token
    activate SyncSvc
    SyncSvc->>SyncSvc: vérifie X-Gitlab-Token<br/>(hash comparé à SECRET_HASH)
    alt Token invalide
        SyncSvc-->>GitLab: HTTP 401<br/>(aucune opération DB2/USS)
    else Token valide
        SyncSvc->>DB2: STATUS = 'PENDING'<br/>TARGET_COMMIT_HASH = commit_hash
        SyncSvc->>USS: git fetch
        SyncSvc->>USS: git reset --hard commit_hash
        USS-->>SyncSvc: OK
        SyncSvc->>SyncSvc: écrit une ligne dans sync-AAAA.jsonl
        SyncSvc->>DB2: STATUS = 'READY'<br/>COMMIT_HASH = TARGET_COMMIT_HASH
        SyncSvc-->>GitLab: HTTP 2xx
    end
    deactivate SyncSvc

    Note over DB2,USS: Tant que STATUS = 'PENDING',<br/>un consommateur qui lit USS<br/>risque une lecture partielle.
```

Quatre points que ce diagramme rend visibles, là où le tableau ne le pouvait pas :

- La vérification du token est la **toute première étape**, avant tout accès à DB2 ou USS — un token invalide ne déclenche donc strictement aucune opération, pas même une écriture `PENDING` (voir [Sécurisation du webhook entrant](#securisation-du-webhook-entrant)).
- `STATUS` passe à `PENDING` **avant** toute opération sur USS, pas après — un consommateur qui interroge DB2 pendant la fenêtre `fetch`/`reset --hard` voit donc bien `PENDING`, jamais un `READY` prématuré.
- `STATUS` ne repasse à `READY` qu'**après** la fin du `reset --hard` et l'écriture du journal — dans cet ordre précis, conformément à la règle posée dans [Vérification côté consommateur](detection-defauts.md#verification-cote-consommateur-verrou-de-synchro).
- La réponse HTTP `2xx` à GitLab n'est envoyée qu'**en dernier**, une fois toute la chaîne terminée avec succès — c'est ce qui permet au calendrier de relance de GitLab (voir l'encart *"Comment GitLab détecte qu'un webhook a échoué"* plus haut sur cette page) de se déclencher si une étape intermédiaire échoue, plutôt que de considérer l'événement traité à tort.

!!! info "Amorçage initial et idempotence"
    Au premier démarrage du service (ou après une réinstallation), tous les workspaces des 600 dépôts doivent être créés en bloc avant que le flux normal de webhooks ne s'applique. Pendant cette fenêtre, un webhook de push peut arriver sur une branche dont le workspace n'a pas encore été créé par l'amorçage.

    Ce cas n'est pas traité comme une erreur, mais **pas parce que `git worktree add` saurait gérer tout seul un dossier déjà existant** — il ne le sait pas : appelée sur un chemin où un worktree existe déjà, cette commande échoue (`fatal: '<path>' already exists`). L'idempotence vient d'une **vérification explicite** faite par le script avant d'agir, la même que celle utilisée par la [resynchronisation complète](../gestion-incidents.md#resynchronisation-complete) :

    Dans le script ci-dessous, `$workspace` désigne le chemin du workspace introduit plus haut (`/u/gitlab/<app>/workspaces/<branche-converti>`), `$branch` le nom de branche GitLab avant conversion, et `$commit_hash` le commit visé par l'événement.

    ```bash
    if [ ! -d "$workspace" ]; then
        git worktree add "$workspace" "$branch"   # seulement si le dossier n'existe pas encore
    fi
    git -C "$workspace" fetch
    git -C "$workspace" reset --hard "$commit_hash"
    ```

    Deux natures différentes se combinent ici :

    - `git worktree add` n'est **pas** idempotent par elle-même — d'où le `if [ ! -d ... ]` qui la protège.
    - `git fetch` et `git reset --hard` le sont : les exécuter une fois ou plusieurs fois sur le même commit produit toujours le même résultat, sans erreur.

    C'est donc le **script dans son ensemble** (vérification + branchement + `reset --hard`) qui est idempotent, pas une commande Git isolée. Résultat : que le webhook de push arrive avant ou après l'amorçage du workspace, l'exécution converge vers le même état final — sans logique dédiée supplémentaire pour distinguer les deux cas.

Chaque opération est **horodatée et journalisée** avec le hash de commit correspondant. Ce journal constitue la preuve d'audit : à chaque instant, on peut établir quel commit était présent sur USS et à quelle heure.

## Rétention et purge des objets git

`git worktree remove` (voir [tableau ci-dessus](#cycle-de-vie-dune-branche)) supprime le **répertoire de travail** de la branche — pas les objets git eux-mêmes (commits, arbres, blobs), qui restent dans `repo/`, le dépôt partagé entre tous les workspaces d'une même application (voir [Les workspaces USS](index.md#les-workspaces-uss-une-branche-un-repertoire)). Ces objets ne redeviennent candidats à la suppression que lors d'un [`git gc`](../../commandes-git.md#linterieur-de-git-object-store-purge-integrite)/repack — et seulement s'ils ne sont plus **atteignables** depuis aucune référence (branche ou tag). C'est ce mécanisme, pas une politique à inventer, qui tranche la question du dépôt qui reste actif après suppression d'une branche : faut-il interdire tout `gc`/repack agressif sur un tel dépôt ?

**Décision retenue : non, `git gc`/repack n'ont pas besoin d'être interdits — à condition qu'un tag protège chaque commit qui doit être retenu.**

Un `git gc` (même agressif) ne touche jamais un objet référencé par un tag, quelle que soit l'ancienneté du tag — contrairement à un objet seulement atteignable par une branche, que la suppression de cette branche rend orphelin. La rétention indéfinie exigée par la bijection source/load de l'IG (*Inspection Générale*, voir [Archivage des sources et load modules obsolètes](../../perspectives.md#archivage-des-sources-et-load-modules-obsoletes)) ne dépend donc pas de la survie de la branche GitLab, mais de l'existence d'un **tag de déploiement** sur le commit qui a produit le load module.

!!! info "Le tag de déploiement, posé au même moment que le tatouage"
    Plutôt que de compter sur une convention manuelle ("un tag créé avant suppression de la branche"), ce tag doit être créé **automatiquement par la CI**, au même instant que le [tatouage](../../perspectives.md#prise-dimage-du-patrimoine-en-production) du load module (build/link-edit) — les deux actent le même événement : ce commit précis a produit ce binaire précis. Un tag annoté, nommé d'après l'identifiant de package (même discriminant que le tatouage, pour garder une seule clé de jointure), rattache ainsi durablement le commit source à son load module, indépendamment du sort ultérieur de la branche GitLab qui l'a porté.

    Une branche qui ne produit jamais de load module (abandonnée avant merge, retours de code review écrasés par un `push --force`) ne reçoit jamais ce tag — ses objets, eux, restent des candidats légitimes à la purge par `gc`, ce qui est le comportement normal et souhaité : seul ce qui a été réellement livré en production doit être retenu indéfiniment, pas chaque commit intermédiaire de travail.

Avec cette discipline en place, un `git gc` périodique côté service de sync n'est donc pas une menace pour la rétention — c'est une hygiène de dépôt standard, qui borne la croissance de `repo/` en écartant ce qui n'a jamais eu vocation à être conservé, sans jamais toucher un commit tagué.

**Autorité sur la suppression d'un tag ou une purge d'objets (deuxième question du point ouvert)** : la politique de rétention déjà actée pour l'archivage de composant est elle-même **indéfinie** ([Archivage des sources et load modules obsolètes](../../perspectives.md#archivage-des-sources-et-load-modules-obsoletes)) — il n'existe donc, par construction, aucun scénario légitime où un tag de déploiement serait supprimé ou un objet purgé sélectivement au sein d'un dépôt applicatif actif. La seule suppression prévue à ce jour est celle, totale, du dépôt entier — arrêt définitif d'une application ou migration de version majeure (voir [Suppression totale d'un dépôt applicatif](../../perspectives.md#suppression-totale-dun-depot-applicatif)) — déjà tranchée avec la même autorité, le **gestionnaire du patrimoine applicatif**. Si la volumétrie imposait un jour une purge partielle malgré tout, ce serait une dérogation à la politique de rétention indéfinie déjà actée, pas une décision opérationnelle isolée : elle relèverait donc de cette même autorité, jamais d'une initiative technique du service de sync. Le compte technique du service de sync (voir [Heartbeat DB2](detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)) n'a d'ailleurs aucun besoin de droits de suppression de tag pour son fonctionnement normal — seule la création de worktrees et les opérations `fetch`/`reset --hard` lui sont nécessaires.

## Journalisation des opérations

Toute opération réalisée par le service de sync sur un workspace USS — création, mise à jour, suppression — est journalisée, quel que soit ce qui la déclenche : webhook normal, [amorçage initial](#cycle-de-vie-dune-branche) ou [resynchronisation complète](../gestion-incidents.md#resynchronisation-complete).

!!! info "Ce journal est distinct de DB2 (SYNC_STATUS)"
    `SYNC_STATUS` (voir [Heartbeat DB2](detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)) porte un **état courant** : une ligne par branche, écrasée à chaque webhook, volontairement bornée en taille (voir [Pas besoin d'index sur LAST_SYNCED_AT](detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)). Il répond à *« quel est l'état actuel ? »*, pas à *« qu'est-ce qui s'est passé, et quand ? »*. La preuve d'audit — établir rétrospectivement quel commit était présent sur USS à un instant donné, même passé — nécessite un historique complet, en ajout continu, que DB2 ne porte pas par construction.

**Format retenu : un fichier JSON Lines par application**, en ajout continu (*append-only*) :

```
/u/gitlab/DA12/journal/sync-2026.jsonl
```

Un format structuré plutôt qu'un texte libre, pour rester exploitable par un outil d'audit sans dépendre d'un parsing ad hoc. Une ligne JSON autonome par opération plutôt qu'un CSV, pour ne pas avoir à gérer l'échappement d'un nom de branche qui peut contenir `/`, espaces ou tout autre caractère valide en Git. Un fichier par application plutôt qu'un journal global, cohérent avec l'indépendance déjà actée entre les ~600 dépôts (voir [Les workspaces USS](index.md#les-workspaces-uss-une-branche-un-repertoire)) : 600 processus concurrents n'écrivent alors jamais dans le même fichier.

!!! info "jq est déjà disponible sur USS"
    `jq`, l'outil standard de requêtage JSON en ligne de commande, est présent nativement sur l'USS du z/OS de cette plateforme. Un journal en JSON Lines est donc directement interrogeable en ligne de commande par un opérateur ou un auditeur (filtrage par branche, par plage d'horodatage, par résultat), sans script de parsing dédié ni outil supplémentaire à installer.

```json
{"ts": "2026-06-17T14:32:07Z", "branch": "pkg/PKG-20260616-0042", "event": "PUSH", "source": "webhook", "commit_before": "a3f7c1d2...", "commit_after": "b91e4a03...", "result": "OK"}
{"ts": "2026-06-17T14:35:12Z", "branch": "pkg/PKG-20260617-0001", "event": "DELETE", "source": "webhook", "commit_before": "c44f2b11...", "commit_after": null, "result": "OK"}
{"ts": "2026-06-18T09:00:03Z", "branch": "pkg/PKG-20260617-0003", "event": "PUSH", "source": "reconciliation", "commit_before": "e72a9d05...", "commit_after": "f18c3e90...", "result": "OK"}
```

| Champ | Rôle |
|---|---|
| `ts` | Horodatage de l'opération (UTC, ISO 8601) |
| `branch` | Nom de branche GitLab tel quel, avant la conversion des `/` en `-` utilisée pour le nom du répertoire workspace |
| `event` | `CREATE` · `PUSH` · `DELETE` — même vocabulaire que `LAST_EVENT_TYPE` en DB2 |
| `source` | `webhook` · `bootstrap` · `reconciliation` — d'où vient l'opération, pour distinguer un flux normal d'une correction |
| `commit_before` / `commit_after` | Hash avant/après l'opération (`null` si non applicable — création ou suppression) |
| `result` | `OK` ou `ERROR` (avec un champ `error` supplémentaire donnant le message en cas d'échec) |

Ce même journal sert de source à la fois au fonctionnement normal (webhooks) et à la [resynchronisation complète](../gestion-incidents.md#resynchronisation-complete) — les deux exécutent les mêmes opérations git, journalisées de la même façon ; seul le champ `source` les distingue.

!!! note "Trois artefacts, trois noms, à ne pas confondre"
    - **Le journal de synchronisation** (ci-dessus) : une ligne par opération git, quel que soit ce qui la déclenche.
    - **Le rapport de réconciliation** (voir [Vérification de l'état ISO](../gestion-incidents.md#verification-de-letat-iso)) : un instantané structuré produit à chaque exécution du job de réconciliation, résumant l'état des ~600 applications à ce moment précis — un artefact agrégé, pas un flux continu.
    - **Le journal du mode dégradé** (voir [Mode dégradé — panne GitLab](../gestion-incidents.md#mode-degrade-panne-gitlab)) : dédié aux actions manuelles hors Git pendant une panne GitLab, sans lien avec le service de sync.

### Rétention et rotation

!!! note "Base de calcul — à affiner plus tard avec les chiffres réels"
    Cette estimation part de deux chiffres connus (50 000 programmes actifs, ~10 % du patrimoine modifié par an) et de plusieurs hypothèses explicites pour combler ce qui n'est pas mesuré. Elle vise un ordre de grandeur, pas une précision — mais l'ordre de grandeur suffit à trancher.

**Ce qu'on sait** : 50 000 programmes actifs, ~10 % modifiés par an → **5 000 programmes modifiés/an**. Le patrimoine réel ne se limite pas aux programmes : il inclut aussi les **copybooks**, des **PAR JCL** (*Job Control Language*) et des procédures stockées, versionnés au même titre et donc générateurs d'activité git propre, **non comptés** dans les 50 000 programmes. Faute de décompte précis pour ces familles, on élargit la borne haute d'environ 50 % par prudence plutôt que de les ignorer : **~7 500 unités modifiées/an**.

**Ce qu'il faut estimer** : un "programme/copybook/PAR modifié" n'est pas un événement git — plusieurs unités peuvent être touchées dans un même package/branche, et un package génère plusieurs `PUSH` avant merge (itérations de dev, retours de code review), plus 1 `CREATE` et 1 `DELETE`.

| Scénario | Packages/an | Événements/package | Événements/an |
|---|---|---|---|
| Bas (packages regroupés, ~5 unités chacun) | 1 500 | ~12 | ~18 000 |
| Haut (correctifs unitaires, ~1 unité chacun) | 7 500 | ~7 | ~52 500 |

→ Fourchette retenue : **~18 000 à ~52 500 événements par an**, tous types confondus, sur l'ensemble du patrimoine (~600 applications).

Avec une ligne JSON d'environ 280 octets (hash SHA-1 complets, pas tronqués) : **~5 à ~14,7 Mo par an**. Cumulé sur 10 ans : ~50 à 147 Mo. Sur 20 ans : ~100 à 294 Mo — négligeable, y compris à cette échelle de temps.

**Décision retenue :**

- **Rétention indéfinie, sans purge.** Le volume ne justifie jamais de supprimer quoi que ce soit — même le scénario haut, sur 50 ans, resterait sous le gigaoctet pour tout le patrimoine.
- **Rotation calendaire annuelle, pas une rotation par taille.** Un fichier par année civile et par application : `/u/gitlab/<app>/journal/sync-2026.jsonl`. À la bascule d'année, le service arrête d'écrire dans le fichier de l'année écoulée et ouvre le suivant (`sync-2027.jsonl`) — sans déplacement ni compression, le fichier clos reste sur place.
- **Le fichier de l'année close passe en lecture seule** (`chmod`) : ça ne change rien au volume, mais ça transforme le fichier en pièce figée — cohérent avec le rôle de preuve d'audit déjà revendiqué pour ce journal.
- **Pas de compression, pas de stockage froid.** À ces tailles (quelques dizaines de Ko par application et par an), la compression ferait gagner un espace négligeable pour le coût de devoir décompresser avant chaque `jq`.

Si le volume réel s'avère un ordre de grandeur au-dessus de cette estimation (hypothèses de départ trop optimistes), cette décision serait à revisiter — mais rien n'indique que ce soit probable ici.

---

Pour savoir comment un défaut de cette synchronisation est détecté et corrigé, voir [Détection et gestion des défauts de synchro](detection-defauts.md).
