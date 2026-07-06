# Gestion des incidents et reprise

!!! warning "En cours de spécification"
    Cette page décrit le runbook prévu pour le service de synchronisation USS (*Unix System Services*), qui n'est pas encore implémenté.

!!! info "Prérequis"
    Cette page suppose une connaissance du mécanisme de synchronisation décrit dans [Résilience et synchronisation USS](resilience/index.md) : webhooks GitLab, heartbeat DB2, cycle de vie d'une branche et réconciliation périodique. Les commandes Git utilisées ici (`rev-parse HEAD`, `worktree`, `reset --hard`...) sont expliquées en détail, à partir de zéro, dans [Commandes Git utilisées dans ce projet](../commandes-git.md) si elles ne vous sont pas familières.

## Incident sur zCX — que se passe-t-il pendant la panne ?

Quand le container zCX (*z/OS Container Extensions*) hébergeant le service de sync est indisponible, GitLab tente de délivrer les webhooks mais reçoit une erreur de connexion. GitLab rejoue automatiquement les webhooks en échec selon un calendrier décroissant :

| Tentative | Délai depuis l'échec précédent |
|---|---|
| 1re relance | 1 minute |
| 2e relance | 5 minutes |
| 3e relance | 10 minutes |
| 4e relance | 100 minutes |
| 5e relance | 100 minutes |

**Fenêtre de grâce totale : environ 3 heures et 36 minutes.** Si le service redémarre dans cette fenêtre, GitLab rejoue les webhooks en attente et USS se resynchronise automatiquement, sans intervention manuelle.

Le **heartbeat DB2** (voir [Résilience et synchronisation USS](resilience/detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)) détecte l'indisponibilité bien avant l'expiration de cette fenêtre — sous ~20 minutes, dès que le service cesse d'écrire son propre signal de vie dans `SYNC_SERVICE_HEARTBEAT` — et alerte l'équipe d'exploitation pendant qu'il reste encore largement le temps d'agir avant que GitLab n'abandonne les relances.

Au-delà de cette fenêtre, les événements webhook sont définitivement perdus côté GitLab. USS peut alors être en retard sur plusieurs commits. La réconciliation périodique détecte cet écart résiduel à sa prochaine exécution et déclenche une resynchronisation automatique — mais si l'incident a duré plusieurs heures, une vérification manuelle reste recommandée.

!!! warning "Ce qu'il faut faire au redémarrage après un incident long"
    1. Vérifier dans les logs GitLab (*Settings → Webhooks → Recent deliveries*) quels événements ont échoué et n'ont pas été rejoués.
    2. Lancer la procédure de vérification ISO (*l'état USS est-il identique à GitLab ?*) décrite ci-dessous.
    3. Déclencher une resynchronisation complète si des écarts sont détectés.
    4. Journaliser l'incident, l'écart constaté et les actions correctives — l'auditeur peut demander cette traçabilité.

---

## Vérification préalable à la bascule en mode dégradé — écart de synchro et santé du mécanisme

!!! info "Un garde-fou, pas une nouvelle stratégie de synchro"
    Ce qui suit ne change rien au mécanisme de synchronisation continue décrit dans [Résilience et synchronisation USS](resilience/index.md) (webhook temps réel, heartbeat, fenêtre de grâce, réconciliation) — cette étape s'ajoute au moment précis où l'on décide de basculer en mode dégradé, pour vérifier que ce qu'on s'apprête à faire (lire USS comme s'il était à jour) repose bien sur un état réellement fiable.

Le [Mode dégradé — panne GitLab](#mode-degrade-panne-gitlab) ci-dessous part d'une hypothèse implicite : que la synchro a fonctionné normalement jusqu'à l'instant de la panne, et que « le dernier état synchronisé sur USS » est donc digne de confiance. Cette hypothèse est vraie dans l'immense majorité des cas — mais deux scénarios la mettent en défaut :

- **Panne GitLab pure** : GitLab devient injoignable, mais le service de sync (zCX, DB2/DRS) était sain jusque-là — le dernier état connu sur USS est fiable, l'écart réel est proche de zéro.
- **Panne composée** : le service de sync lui-même était déjà dégradé (webhooks en échec silencieux, heartbeat hors délai) avant ou pendant l'indisponibilité de GitLab — auquel cas « le dernier état synchronisé » peut être plus ancien que ce que l'équipe suppose au moment de basculer.

Rien dans le mécanisme actuel ne distingue automatiquement ces deux cas au moment de la décision de bascule — le heartbeat et la réconciliation détectent bien une panne, mais à leur propre cadence, pas à l'instant précis où un opérateur s'apprête à déclarer le mode dégradé. C'est ce trou que cette vérification comble : elle objective l'écart avant la bascule, plutôt que de le présumer.

**Décision retenue : avant toute bascule en mode dégradé, une vérification explicite de l'écart entre GitLab et USS est exécutée et journalisée** — que la bascule soit déclenchée par une panne GitLab ou par une panne zCX dépassant la fenêtre de grâce (~3h36, voir [Incident sur zCX](#incident-sur-zcx-que-se-passe-t-il-pendant-la-panne)).

### Que vérifier, selon ce qui reste joignable

| Ce qui est joignable | Vérification | Ce qu'elle donne |
|---|---|---|
| GitLab (au moins son API/protocole git), même si le service de sync est en panne | Comparaison directe des hash `HEAD` par branche — même principe que la [Vérification de l'état ISO](#verification-de-letat-iso), déclenchée à la demande plutôt qu'à la cadence du job planifié | L'écart réel, en nombre de commits, entre GitLab et USS |
| GitLab injoignable (la panne visée est GitLab lui-même) | Lecture des derniers signaux internes déjà enregistrés : fraîcheur de `SYNC_SERVICE_HEARTBEAT`, nombre de branches restées à `STATUS = 'PENDING'` dans `SYNC_STATUS`, dernières entrées du [journal de synchronisation](resilience/service-synchronisation.md#journalisation-des-operations) | Jusqu'à quel instant la synchro était confirmée saine — pas l'écart réel (impossible à mesurer sans GitLab), mais une borne de confiance sur le dernier état connu |

!!! warning "Quand GitLab est injoignable, on ne peut pas mesurer l'écart réel — seulement sa dernière confirmation connue"
    Un script du type `git log mirror/main..main --oneline` (ou l'appel API équivalent) suppose un accès simultané aux deux dépôts — GitLab et USS. Si GitLab est précisément ce qui est en panne, cette comparaison directe est impossible par construction : c'est le signal interne déjà collecté côté sync (heartbeat, `SYNC_STATUS`, journal) qui prend le relais, pour établir jusqu'à quand la chaîne était en bonne santé plutôt que ce qui a été raté depuis.

### Exemple illustratif de fonctionnement

!!! example "Exemple illustratif — pas un incident réel"
    Les commandes, sorties, hash et horodatages ci-dessous sont fictifs, choisis uniquement pour illustrer le mécanisme de contrôle décrit plus haut (cas où GitLab reste joignable). Ils ne documentent aucun incident réel survenu sur la plateforme, et le format exact du journal du mode dégradé n'est pas figé par cet exemple.

Les deux cas partagent la même commande — `check-mirror-drift.sh <app> <branche>`, qui encapsule la comparaison `git log mirror/<branche>..origin/<branche> --oneline` :

**Cas 1 — écart détecté**

```
$ check-mirror-drift.sh DA12 pkg/PKG-20260616-0042

Comparaison GitLab (origin) ↔ USS (mirror) — DA12 / pkg/PKG-20260616-0042
git log mirror/pkg/PKG-20260616-0042..origin/pkg/PKG-20260616-0042 --oneline

b91e4a03 feat: ajoute validation du champ montant
c1d2f7a3 fix: corrige arrondi de la taxe

RÉSULTAT : ÉCART — 2 commit(s) présents sur GitLab, absents du mirror USS
Dernier commit confirmé sur le mirror : a3f7c1d2 (2026-06-17T14:32:07Z)
```

Entrée journalisée correspondante, avant la bascule :

| Champ | Valeur |
|---|---|
| Horodatage | 2026-06-17T15:05:00Z |
| Application / branche | DA12 / pkg/PKG-20260616-0042 |
| Vérification exécutée | `check-mirror-drift.sh` |
| Résultat | `ÉCART` — 2 commits en attente |
| Dernier commit mirror confirmé | `a3f7c1d2` |
| Action | Bascule en mode dégradé actée, écart connu et journalisé — pas une confiance implicite |

**Cas 2 — synchro confirmée**

```
$ check-mirror-drift.sh DA12 pkg/PKG-20260616-0042

Comparaison GitLab (origin) ↔ USS (mirror) — DA12 / pkg/PKG-20260616-0042
git log mirror/pkg/PKG-20260616-0042..origin/pkg/PKG-20260616-0042 --oneline

(sortie vide)

RÉSULTAT : OK — mirror synchronisé, aucun commit manquant
Dernier commit connu (GitLab = mirror) : a3f7c1d2 (2026-06-17T14:32:07Z)
```

Entrée journalisée correspondante, avant la bascule :

| Champ | Valeur |
|---|---|
| Horodatage | 2026-06-17T15:05:00Z |
| Application / branche | DA12 / pkg/PKG-20260616-0042 |
| Vérification exécutée | `check-mirror-drift.sh` |
| Résultat | `OK` — aucun écart |
| Dernier commit mirror confirmé | `a3f7c1d2` |
| Action | Bascule en mode dégradé actée avec confiance maximale sur le dernier état |

Dans les deux cas, c'est la présence de cette entrée — pas seulement son résultat — qui compte pour l'audit : elle prouve que la vérification a bien eu lieu au moment de la bascule, plutôt que d'être supposée.

### Comment cette vérification s'exécute — et qui en est responsable

Deux formes d'exécution sont visées, non exclusives l'une de l'autre :

- **Un script autonome, exploitable manuellement** (`check-mirror-drift.sh` ou équivalent) — utilisable par un opérateur en pleine gestion d'incident, sans dépendre d'un outillage qui pourrait lui-même être affecté par la panne en cours.
- **Une intégration à terme dans l'outillage CI existant** — un déclenchement automatique (ou une alerte de rappel) au moment où une bascule en mode dégradé est amorcée, pour que cette vérification ne repose pas uniquement sur le réflexe d'un opérateur au moment critique.

!!! warning "Sans propriétaire explicite, ce garde-fou ne sert à rien"
    Un script disponible mais que personne n'est chargé de lancer, ou une intégration CI sans destinataire d'alerte, ne protège personne — c'est exactement l'écueil déjà écarté ailleurs dans ce projet pour le heartbeat et la réconciliation (voir [Heartbeat DB2](resilience/detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)). **Décision retenue : la responsabilité de déclencher cette vérification (manuellement) ou de confirmer qu'un déclenchement automatique a bien eu lieu revient à l'opérateur qui décide de la bascule** — au même titre que les autres actions du runbook déjà tracées dans le [journal du mode dégradé](#mode-degrade-panne-gitlab). Qui, précisément, porte cette responsabilité au quotidien (astreinte, équipe d'exploitation) rejoint la question plus large de la couverture horaire pas encore formalisée pour ce service (voir [Points non couverts](../points-ouverts.md#fiabilite-du-dispositif-de-mitigation-constats-de-lanalyse-technique)) — pas un point que cette page seule peut trancher.

### Ce que cette vérification confirme, pour l'audit

Deux objectifs distincts, tous deux tracés dans le journal du mode dégradé au même titre que les actions manuelles qu'il enregistre déjà (voir [Mode dégradé — panne GitLab](#mode-degrade-panne-gitlab)) :

1. **Preuve que le mécanisme de synchro temps réel a fonctionné normalement jusqu'à l'incident** — un élément de traçabilité utile à l'auditeur, distinct du [rapport de réconciliation périodique](#verification-de-letat-iso), qui ne couvre pas nécessairement l'instant précis de la bascule.
2. **Détection explicite d'une panne composée** — le cas où le service de sync était déjà affecté avant ou pendant la panne GitLab, ce qui change la nature de l'incident (voir [Catalogue des pannes et conséquences](resilience/pannes-et-consequences.md)) : ce n'est alors plus une simple panne GitLab isolée, mais une défaillance touchant à la fois la source et le mécanisme censé la refléter.

!!! note "Une donnée d'entrée pour un futur RPO, pas une valeur à fixer ici"
    L'écart mesuré (ou, à défaut, la dernière confirmation de santé) donne une donnée concrète et objectivable — utile le jour où le [RTO/RPO du service de sync](../points-ouverts.md#fiabilite-du-dispositif-de-mitigation-constats-de-lanalyse-technique) sera formellement engagé par l'organisation. Ce n'est pas ce garde-fou qui fixe un RPO : il fournit seulement la mesure sur laquelle un futur arbitrage pourra s'appuyer.

---

## Mode dégradé — panne GitLab

!!! info "Prérequis à cette bascule"
    Avant de déclarer ce mode, voir [Vérification préalable à la bascule en mode dégradé](#verification-prealable-a-la-bascule-en-mode-degrade-ecart-de-synchro-et-sante-du-mecanisme).

Ce cas est différent d'une panne zCX : c'est ici **GitLab lui-même** qui est inaccessible, pas seulement le service de sync. USS reste lisible (dernier état synchronisé avant la panne), mais reste strictement **en lecture** — seul le mécanisme de synchronisation est autorisé à écrire sur USS, jamais un opérateur, y compris en mode dégradé.

Toutes les actions habituellement portées par la chaîne CI/CD (*Continuous Integration / Continuous Delivery*) GitLab (build, packaging, promotion, déploiement) doivent pouvoir continuer à s'exécuter à partir du dernier état synchronisé sur USS, mais **hors GitLab**, via des procédures dégradées ou manuelles équivalentes à ce qui existait déjà sous ChangeMan.

Comme sous ChangeMan, où chacune de ces actions dégradées était tracée dans un journal dédié, ce même besoin s'applique ici : toute action exécutée hors GitLab pendant la panne (qui, quoi, sur quelle application/branche/package, quand) doit être enregistrée dans **le journal du mode dégradé**, distinct du journal de synchronisation normal. Ce journal sert de base, au retour de GitLab, pour reporter manuellement dans GitLab l'ensemble des actions effectuées pendant la panne (commits, tags, statuts de déploiement) et restaurer la cohérence entre GitLab et la réalité de production.

### Correctif de code en urgence pendant la panne

**Décision retenue : le mode dégradé interdit toute modification de code tant que GitLab n'est pas revenu — on ne fait que rejouer le dernier état déjà synchronisé (build, promotion, déploiement).**

Cette interdiction n'est pas une contrainte ajoutée pour ce cas précis : c'est une conséquence directe de la règle déjà posée plus haut sur cette page — USS reste strictement en lecture, y compris en mode dégradé, et seul le service de sync est autorisé à y écrire. Éditer un source directement sur USS pendant la panne violerait cette règle, et romprait la garantie d'identité avec GitLab que ce miroir a précisément pour vocation de certifier (voir [La contrainte de départ](resilience/index.md#la-contrainte-de-depart)) : au retour de GitLab, le prochain [`fetch`](../commandes-git.md#les-commandes-de-base-deja-connues)/[`reset --hard`](../commandes-git.md#reset-hard-une-commande-destructive-volontairement) du service de sync écraserait silencieusement ce correctif sans laisser de trace, puisque GitLab — la source de vérité — n'en aurait jamais eu connaissance.

!!! warning "Un vrai besoin de correctif vital reste possible — mais hors de ce mécanisme"
    Rien n'empêche qu'un correctif de production soit réellement nécessaire pendant que GitLab est inaccessible. Ce cas n'appelle toutefois pas une procédure « hors Git » propre à ce projet : c'est le processus d'urgence générique de gestion des changements de l'établissement (déjà existant, indépendant de GitLab et du service de sync) qui prend le relais, exactement comme il le ferait pour toute autre panne d'infrastructure empêchant un déploiement normal. Un tel correctif s'appliquerait alors directement sur le *load module* en production — jamais sur USS — via cette procédure d'urgence existante.

    Un correctif appliqué de cette façon rompt temporairement la [bijection source/load](../perspectives.md#prise-dimage-du-patrimoine-en-production) exigée par l'IG (*Inspection Générale*) : le binaire alors en production ne correspond plus à un commit GitLab. Dès le retour de GitLab, ce correctif doit être **reproduit comme un vrai commit**, buildé et tatoué normalement, pour restaurer la bijection — et non laissé tel quel indéfiniment. Le [journal du mode dégradé](#mode-degrade-panne-gitlab) tracera cette divergence temporaire au même titre que les autres actions dégradées, pour que l'auditeur retrouve sans ambiguïté la période et la raison pendant laquelle la bijection n'était pas respectée.

---

## Vérification de l'état ISO

« ISO » est utilisé ici dans son sens littéral d'**identique** (isomorphe) — pas la norme ISO (*International Organization for Standardization*). Un workspace « ISO » est un workspace dont le contenu est rigoureusement identique à la branche GitLab correspondante.

La vérification compare le **hash de commit HEAD** (le pointeur Git désignant le commit courant du workspace) connu pour chaque branche avec l'état de cette même branche sur GitLab. Un hash git est une empreinte cryptographique unique d'un état du code : deux états identiques produisent le même hash.

```
# Hash connu pour une branche — lu en DB2 (rapide, pas besoin de toucher USS)
# APP_CODE est indispensable : la même branche "pkg/..." ou "main" existe
# de façon indépendante dans chacune des 600 applications.
SELECT COMMIT_HASH FROM SYNC_STATUS
WHERE APP_CODE = 'DA12' AND BRANCH_NAME = 'pkg/PKG-20260616-0042';
# → a3f7c1d2...

# Hash de la même branche sur GitLab (API du projet DA12)
GET /api/v4/projects/DA12/repository/branches/pkg%2FPKG-20260616-0042
# → { "commit": { "id": "a3f7c1d2..." } }
```

Si les deux hashes sont identiques, le workspace est ISO. S'ils diffèrent, le workspace est en retard d'un ou plusieurs commits — auquel cas le job vérifie aussi [`git -C <workspace> rev-parse HEAD`](../commandes-git.md#le-commit-comme-objet-et-head-comme-pointeur) directement sur USS, pour distinguer un simple retard d'une divergence entre DB2 et l'état réel du workspace.

Le job de réconciliation exécute cette comparaison, application par application, pour toutes les branches actives et produit un rapport structuré :

```
RAPPORT RÉCONCILIATION — 2026-06-17 14:00:01
──────────────────────────────────────────────────────────
APP    BRANCHE                 USS HEAD    GITLAB HEAD  ÉTAT
DA12   main                    a3f7c1d2    a3f7c1d2     ✓ ISO
DA12   pkg/PKG-20260616-0042   b91e4a03    b91e4a03     ✓ ISO
DY07   pkg/PKG-20260617-0001   c44f2b11    e72a9d05     ✗ RETARD (2 commits)
──────────────────────────────────────────────────────────
1 écart détecté — resynchronisation déclenchée automatiquement
```

Ce rapport est archivé sur USS dans un fichier horodaté dédié — distinct du [journal de synchronisation](resilience/service-synchronisation.md#journalisation-des-operations), qui trace chaque opération individuelle plutôt qu'un instantané global — et consultable par les auditeurs.

---

## Resynchronisation complète

La resynchronisation complète reconstruit l'état USS à partir de GitLab comme source de vérité. Elle peut être déclenchée **automatiquement** par le job de réconciliation en cas d'écart, ou **manuellement** par un opérateur après un incident.

La procédure couvre quatre cas :

| Situation détectée | Action |
|---|---|
| Branche GitLab présente, workspace USS absent | [`git worktree add`](../commandes-git.md#worktree-plusieurs-repertoires-de-travail-pour-un-seul-depot) — crée le workspace |
| Workspace USS en retard sur GitLab | `git -C <workspace> fetch && git -C <workspace> reset --hard origin/<branche>` — réaligne sur GitLab |
| Workspace USS au niveau de GitLab | Aucune action — log `OK` |
| Workspace USS présent, branche GitLab supprimée | [`git worktree remove`](../commandes-git.md#worktree-plusieurs-repertoires-de-travail-pour-un-seul-depot) — supprime l'orphelin |

```bash
# Squelette de la procédure de resynchronisation complète
# (exécutée par le service de sync ou manuellement par un opérateur)
# Rejouée indépendamment pour chacune des ~600 applications (code CAPIREF
# DAxx ou DYxx) — une application n'a aucune visibilité sur les autres.
#
# gitlab_api est un helper fictif représentant l'appel réel à l'API GitLab
# (authentification, pagination, etc. non détaillés ici). jq est l'outil de
# requêtage JSON défini dans glossaire.md#jq (voir aussi son usage détaillé dans
# resilience/service-synchronisation.md#journalisation-des-operations).

APP=$1   # ex. DA12 — code CAPIREF de l'application traitée
GITLAB_BRANCHES=$(gitlab_api GET /projects/$APP/repository/branches | jq -r '.[].name')
USS_BASE=/u/gitlab/$APP/workspaces

for branch in $GITLAB_BRANCHES; do
    workspace="$USS_BASE/$(echo $branch | tr '/' '-')"
    gitlab_head=$(gitlab_api GET /projects/$APP/repository/branches/$branch \
                  | jq -r '.commit.id')

    if [ ! -d "$workspace" ]; then
        git -C /u/gitlab/$APP/repo worktree add "$workspace" "$branch"
        log "CRÉÉ  $APP/$branch → $gitlab_head"
    else
        uss_head=$(git -C "$workspace" rev-parse HEAD)
        if [ "$uss_head" != "$gitlab_head" ]; then
            git -C "$workspace" fetch
            git -C "$workspace" reset --hard "origin/$branch"  # (1)!
            log "MIS À JOUR  $APP/$branch  $uss_head → $gitlab_head"
        else
            log "OK  $APP/$branch  $uss_head"
        fi
    fi
done

# Suppression des worktrees orphelins
for workspace in $USS_BASE/*/; do
    branch=$(basename "$workspace" | tr '-' '/')
    if ! echo "$GITLAB_BRANCHES" | grep -q "^$branch$"; then
        git -C /u/gitlab/$APP/repo worktree remove "$workspace"
        log "SUPPRIMÉ  $APP/$branch (branche absente de GitLab)"
    fi
done
```

1. `reset --hard` (et non `pull`) garantit que USS reflète exactement GitLab même si le workspace a été modifié manuellement — USS est un miroir réglementaire, pas un espace de travail libre.

Chaque appel à `log` ci-dessus écrit en réalité une entrée dans le [journal de synchronisation](resilience/service-synchronisation.md#journalisation-des-operations) — même format JSON Lines que le flux webhook normal, avec `"source": "reconciliation"` — plutôt qu'une simple ligne de texte : le pseudo-code ci-dessus simplifie l'appel pour rester lisible. Ce journal, horodaté avec le hash avant et après chaque opération, constitue la preuve d'audit de la reprise.

??? info "Durée d'une vérification et d'une resynchronisation complète (détail optionnel)"
    **Vérification (~600 applications, une passe par application)**

    Le nombre réel de branches actives par application (`main` plus, le cas échéant, quelques packages en cours) n'est pas chiffré dans ce corpus — l'estimation ci-dessous raisonne donc par application, pas sur un total exhaustif toutes branches confondues.

    Le goulot d'étranglement n'est pas USS — lire les hashes locaux d'une application (`git rev-parse HEAD` par workspace) prend une fraction de seconde. C'est l'interrogation de GitLab qui compte, et elle dépend de l'implémentation :

    | Approche (par application) | Appels API | Temps estimé pour ~600 applications |
    |---|---|---|
    | Un appel par branche de l'application | Variable — dépend du nombre de branches actives | Non chiffré, proportionnel au nombre total de branches |
    | Liste paginée des branches de l'application (`per_page=100`) | 1 par application (une application dépasse rarement 100 branches actives) | ~600 appels au total — **~60 secondes** à ~100 ms/appel |

    L'approche paginée est la seule acceptable : un seul appel par application suffit à récupérer toutes ses branches et leurs hashes de commit en une fois, plutôt que d'interroger l'API une fois par branche.

    **Resynchronisation effective**

    Hors incident, le nombre de branches en écart est faible. Un [`git pull`](../commandes-git.md#les-commandes-de-base-deja-connues) sur un workspace en retard de 1 à 2 commits prend moins d'une seconde. Par application, la resynchronisation complète après un incident long (plusieurs heures) reste sous la minute, création de worktrees incluse — pour l'ensemble du patrimoine (~600 applications), l'ordre de grandeur reste du même ordre, sous réserve du nombre réel de branches actives, non chiffré ici.
