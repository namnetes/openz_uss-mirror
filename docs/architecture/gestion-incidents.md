# Gestion des incidents et reprise

!!! warning "En cours de spécification"
    Cette page décrit le runbook prévu pour le service de synchronisation USS (*Unix System Services*), qui n'est pas encore implémenté.

!!! info "Prérequis"
    Cette page suppose une connaissance du mécanisme de synchronisation décrit dans [Résilience et synchronisation USS](resilience/index.md) : webhooks GitLab, heartbeat DB2, cycle de vie d'une branche et réconciliation périodique.

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

## Mode dégradé — panne GitLab

Ce cas est différent d'une panne zCX : c'est ici **GitLab lui-même** qui est inaccessible, pas seulement le service de sync. USS reste lisible (dernier état synchronisé avant la panne), mais reste strictement **en lecture** — seul le mécanisme de synchronisation est autorisé à écrire sur USS, jamais un opérateur, y compris en mode dégradé.

Toutes les actions habituellement portées par la chaîne CI/CD (*Continuous Integration / Continuous Delivery*) GitLab (build, packaging, promotion, déploiement) doivent pouvoir continuer à s'exécuter à partir du dernier état synchronisé sur USS, mais **hors GitLab**, via des procédures dégradées ou manuelles équivalentes à ce qui existait déjà sous ChangeMan.

Comme sous ChangeMan, où chacune de ces actions dégradées était tracée dans un journal dédié, ce même besoin s'applique ici : toute action exécutée hors GitLab pendant la panne (qui, quoi, sur quelle application/branche/package, quand) doit être enregistrée dans **le journal du mode dégradé**, distinct du journal de synchronisation normal. Ce journal sert de base, au retour de GitLab, pour reporter manuellement dans GitLab l'ensemble des actions effectuées pendant la panne (commits, tags, statuts de déploiement) et restaurer la cohérence entre GitLab et la réalité de production.

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

Si les deux hashes sont identiques, le workspace est ISO. S'ils diffèrent, le workspace est en retard d'un ou plusieurs commits — auquel cas le job vérifie aussi `git -C <workspace> rev-parse HEAD` directement sur USS, pour distinguer un simple retard d'une divergence entre DB2 et l'état réel du workspace.

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
| Branche GitLab présente, workspace USS absent | `git worktree add` — crée le workspace |
| Workspace USS en retard sur GitLab | `git -C <workspace> fetch && git -C <workspace> reset --hard origin/<branche>` — réaligne sur GitLab |
| Workspace USS au niveau de GitLab | Aucune action — log `OK` |
| Workspace USS présent, branche GitLab supprimée | `git worktree remove` — supprime l'orphelin |

```bash
# Squelette de la procédure de resynchronisation complète
# (exécutée par le service de sync ou manuellement par un opérateur)
# Rejouée indépendamment pour chacune des ~600 applications (code CAPIREF
# DAxx ou DYxx) — une application n'a aucune visibilité sur les autres.
#
# gitlab_api est un helper fictif représentant l'appel réel à l'API GitLab
# (authentification, pagination, etc. non détaillés ici). jq est l'outil de
# requêtage JSON déjà présenté dans
# resilience/service-synchronisation.md#journalisation-des-operations (voir jq).

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
    **Vérification (600 branches)**

    Le goulot d'étranglement n'est pas USS — lire 600 hashes locaux (`git rev-parse HEAD`) prend moins d'une seconde. C'est l'interrogation de GitLab qui compte, et elle dépend de l'implémentation :

    | Approche | Appels API | Temps estimé |
    |---|---|---|
    | Un appel par branche | 600 | ~60 secondes |
    | Liste paginée (`per_page=100`) | 6 | **2 – 5 secondes** |

    L'approche paginée est la seule acceptable : 6 appels suffisent pour récupérer les 600 hashes GitLab, la comparaison en mémoire est négligeable.

    **Resynchronisation effective**

    Hors incident, le nombre de branches en écart est faible. Un `git pull` sur un workspace en retard de 1 à 2 commits prend moins d'une seconde. La resynchronisation complète après un incident long (plusieurs heures) reste sous la minute pour 600 branches, création de worktrees incluse.
