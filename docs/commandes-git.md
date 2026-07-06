# Commandes Git utilisées dans ce projet

!!! info "Prérequis"
    Aucun — cette page est le point de départ si vous découvrez Git dans le cadre de ce projet.

Cette documentation utilise, dans plusieurs pages techniques, des commandes Git qui dépassent largement ce qu'un tutoriel Git standard enseigne (`push`, `pull`, `commit`...). Cette page les explique toutes, dans l'ordre, en partant de zéro — pour qu'un lecteur qui n'a jamais utilisé Git puisse suivre le reste du corpus sans blocage.

## Les quatre notions de base avant la première commande {: #les-quatre-notions-de-base-avant-la-premiere-commande }

Avant toute commande, quatre notions suffisent à comprendre ce qui suit.

**Dépôt** — le dossier dont Git suit l'historique complet : chaque modification, une fois enregistrée (voir *commit* ci-dessous), y reste pour toujours, avec qui l'a faite et quand. Dans ce projet, chaque application (code [CAPIREF](glossaire.md#application-code-capiref)) possède son propre dépôt — c'est ce dépôt, partagé, qui permet à plusieurs [workspaces](glossaire.md#workspace) de coexister sans dupliquer tout l'historique (voir [Worktree](#worktree-plusieurs-repertoires-de-travail-pour-un-seul-depot) plus bas). Voir aussi [glossaire.md#depot-git](glossaire.md#depot-git).

**Commit** — un instantané horodaté du code à un instant donné. C'est l'unité de base que toutes les commandes de cette page manipulent, d'une façon ou d'une autre. Définition complète : [glossaire.md#commit-git](glossaire.md#commit-git).

**Branche** — une ligne de développement indépendante au sein d'un même dépôt. Dans ce projet, chaque branche GitLab active dispose de son propre répertoire de travail sur USS (voir [Worktree](#worktree-plusieurs-repertoires-de-travail-pour-un-seul-depot)). Définition complète : [glossaire.md#branche-git](glossaire.md#branche-git).

**Hash de commit** — l'identifiant unique de chaque commit. C'est ce qui permet de vérifier que deux endroits (GitLab et USS) contiennent exactement le même code, sans comparer fichier par fichier — un mécanisme central dans ce projet (voir [Le commit comme objet, et HEAD comme pointeur](#le-commit-comme-objet-et-head-comme-pointeur) plus bas). Définition complète : [glossaire.md#hash-de-commit](glossaire.md#hash-de-commit).

**Remote** (`origin`) — un dépôt distant auquel un dépôt local est relié, pour y envoyer ou en récupérer des commits. `origin` est le nom conventionnel donné par défaut à ce remote principal — dans ce projet, GitLab joue ce rôle pour chacun des ~600 dépôts applicatifs. Voir aussi [glossaire.md#remote](glossaire.md#remote).

## Piloter Git sans s'y déplacer : le flag `-C` {: #piloter-git-sans-sy-deplacer-le-flag-c }

Un tutoriel Git standard enseigne un réflexe : se placer dans le dossier du dépôt (`cd mon-projet`) avant de taper la moindre commande. Ce réflexe ne fonctionne pas ici — le service de sync pilote potentiellement des milliers de workspaces (~600 applications, plusieurs branches actives chacune) sans jamais « se trouver » dans l'un d'eux : un script boucle sur des chemins, un par un.

Le flag `-C <chemin>` résout exactement ce problème : il dit à Git *« agis comme si tu étais dans ce dossier »*, sans avoir à s'y déplacer.

```bash
# Sans -C — le réflexe du tutoriel standard, un `cd` par workspace
cd /u/gitlab/DA12/workspaces/pkg-PKG-20260616-0042
git fetch
git reset --hard origin/pkg/PKG-20260616-0042
cd -   # il faut penser à revenir, ou perdre le fil du script

# Avec -C — ce que fait réellement le service de sync
git -C /u/gitlab/DA12/workspaces/pkg-PKG-20260616-0042 fetch
git -C /u/gitlab/DA12/workspaces/pkg-PKG-20260616-0042 reset --hard origin/pkg/PKG-20260616-0042
```

Le second bloc ne déplace jamais le script d'un dossier à l'autre — chaque ligne est indépendante et précise elle-même sur quel workspace elle agit. C'est exactement ce que fait la [procédure de resynchronisation complète](architecture/gestion-incidents.md#resynchronisation-complete), qui boucle sur des centaines de branches de cette façon, ainsi que l'[amorçage initial](architecture/resilience/service-synchronisation.md#cycle-de-vie-dune-branche) du service de sync.

## Les commandes de base déjà connues {: #les-commandes-de-base-deja-connues }

Ces cinq commandes sont celles qu'un tutoriel Git standard enseigne en premier. Ce projet ne leur donne pas un sens différent — seule leur mise en contexte change.

**`git push`** — envoie des commits enregistrés localement vers un [remote](#les-quatre-notions-de-base-avant-la-premiere-commande). Dans ce projet, c'est ce que fait un développeur pour proposer un changement — le webhook qui déclenche toute la synchronisation USS se déclenche d'ailleurs quel que soit le canal utilisé (CLI, interface web GitLab, API), pas seulement `git push` en ligne de commande. Voir [Le service de synchronisation](architecture/resilience/service-synchronisation.md#cycle-de-vie-dune-branche).

**`git pull`** — récupère les commits distants (comme `fetch`, voir ci-dessous) puis les **fusionne** automatiquement dans la branche locale. Ce projet ne l'utilise **jamais** pour synchroniser USS — et c'est un choix délibéré, voir juste en dessous.

**`git fetch`** — télécharge les nouveaux commits distants **sans toucher à aucun fichier** du répertoire de travail. C'est une mise à jour de la connaissance de l'historique, invisible tant qu'on ne l'exploite pas explicitement.

!!! info "`fetch` vs `pull` : la distinction qui compte le plus dans ce projet"
    `git pull` est un raccourci pour `git fetch` suivi d'une **fusion** (*merge*) automatique des changements distants dans la copie locale. C'est très bien adapté à un poste de développeur, où l'on veut intégrer les nouveautés distantes **en plus** de son propre travail en cours.

    USS n'a jamais de « travail en cours » à préserver — c'est un miroir en lecture seule (voir [La contrainte de départ](architecture/resilience/index.md#la-contrainte-de-depart)). Ce projet enchaîne donc `fetch` (télécharger l'historique) puis [`reset --hard`](#reset-hard-une-commande-destructive-volontairement) (imposer cet état aux fichiers) plutôt qu'un `pull` qui fusionnerait — voir le détail complet dans [Cycle de vie d'une branche](architecture/resilience/service-synchronisation.md#cycle-de-vie-dune-branche).

**`git status`** (et son option `--porcelain`, un format de sortie stable pensé pour être lu par un script plutôt que par un humain) — compare les fichiers réellement présents sur disque à ce que Git attend pour le commit courant. Une sortie vide signifie qu'il n'y a aucune différence. Dans ce projet, c'est le mécanisme retenu pour vérifier qu'un workspace est **propre** avant qu'un consommateur ne le lise — voir [Vérification de la propreté](architecture/resilience/detection-defauts.md#verification-de-la-proprete-integrite-du-contenu).

**`git diff`** — affiche (ou, avec `--quiet`, signale juste l'existence d') une différence entre deux états du dépôt. Cité dans ce projet comme variante possible de `git status` pour la même vérification de propreté.

## Le commit comme objet, et HEAD comme pointeur {: #le-commit-comme-objet-et-head-comme-pointeur }

**`git rev-parse HEAD`** — affiche le hash du commit actuellement extrait (*checked out*) dans un répertoire de travail donné.

Pour comprendre cette commande, il faut d'abord savoir ce qu'est [`HEAD`](glossaire.md#head) : dans Git, `HEAD` est le pointeur qui désigne ce commit précis — pas « la dernière version » au sens flou, mais une référence exacte et vérifiable. `rev-parse` sert ici à transformer ce pointeur en une valeur exploitable (le hash lui-même), plutôt qu'à afficher un historique lisible par un humain (ce que ferait `git log`).

Le cas d'usage réel de ce projet : comparer le hash `HEAD` d'un workspace USS au hash connu de la même branche en DB2 et sur GitLab, pour établir sans ambiguïté si le workspace est à jour ou en retard — voir [Vérification de l'état ISO](architecture/gestion-incidents.md#verification-de-letat-iso).

## `reset --hard` : une commande destructive, volontairement {: #reset-hard-une-commande-destructive-volontairement }

**`git reset --hard <commit>`** — force les fichiers du répertoire de travail à correspondre **exactement** au commit précisé, en écrasant sans avertissement tout ce qui s'y trouvait avant.

C'est une commande dangereuse en général : sur un poste de développeur, elle ferait perdre irrémédiablement toute modification locale non commitée (voir [Commit](#les-quatre-notions-de-base-avant-la-premiere-commande)) — d'où la réputation de `reset --hard` comme commande « à manier avec précaution » dans n'importe quel tutoriel Git.

C'est précisément pour cette raison qu'elle convient ici : USS est un miroir strictement en lecture (voir [La contrainte de départ](architecture/resilience/index.md#la-contrainte-de-depart)), il n'y a donc **jamais** de travail local à préserver — seul le service de sync écrit sur USS, et uniquement pour refléter GitLab. Ce qui serait risqué ailleurs devient ici le comportement exact recherché : garantir que USS reflète GitLab au bit près, sans exception. Détail complet dans [Cycle de vie d'une branche](architecture/resilience/service-synchronisation.md#cycle-de-vie-dune-branche).

## Worktree : plusieurs répertoires de travail pour un seul dépôt {: #worktree-plusieurs-repertoires-de-travail-pour-un-seul-depot }

Cette page ne redéfinit pas ce qu'est un *worktree* — voir [glossaire.md#worktree-git-worktree](glossaire.md#worktree-git-worktree) pour le concept. L'objet ici est le déroulé concret des deux commandes qui le manipulent.

**`git worktree add <chemin> <branche>`** — crée un nouveau répertoire de travail pour la branche indiquée, à l'emplacement précisé. Les fichiers propres à cette branche sont écrits à cet endroit ; les objets Git (commits, arbres, blobs) restent partagés avec le dépôt principal — aucune duplication de l'historique.

```bash
git -C /u/gitlab/DA12/repo worktree add /u/gitlab/DA12/workspaces/pkg-PKG-20260616-0042 pkg/PKG-20260616-0042
```

**`git worktree remove <chemin>`** — supprime ce répertoire de travail. Attention à une nuance importante : cette commande supprime le *répertoire*, pas les objets Git eux-mêmes, qui restent dans le dépôt partagé tant qu'aucun `git gc` ne les juge inatteignables (voir [L'intérieur de Git](#linterieur-de-git-object-store-purge-integrite) plus bas) :

```bash
git -C /u/gitlab/DA12/repo worktree remove /u/gitlab/DA12/workspaces/pkg-PKG-20260616-0042
```

Dans ce projet, ces deux commandes sont déclenchées automatiquement par les événements GitLab (création/suppression de branche) — voir [Cycle de vie d'une branche](architecture/resilience/service-synchronisation.md#cycle-de-vie-dune-branche) — et la nuance ci-dessus est précisément ce qui a motivé la politique de [rétention et purge des objets git](architecture/resilience/service-synchronisation.md#retention-et-purge-des-objets-git).

## L'intérieur de Git : object store, purge, intégrité {: #linterieur-de-git-object-store-purge-integrite }

Un dépôt Git n'est, en interne, qu'une base de données de trois types d'**objets** : les *blobs* (le contenu d'un fichier), les *arbres* (la structure d'un dossier à un instant donné) et les *commits* (un instantané complet, référençant un arbre). Chaque objet est identifié par le hash de son propre contenu — c'est ce qui rend cette base de données *content-addressable* : deux fichiers identiques, même dans deux commits différents, partagent le même objet.

Un objet est dit **atteignable** tant qu'on peut y arriver en suivant une référence — une branche, ou un [**tag**](glossaire.md#branche-git) (une étiquette qui pointe, elle aussi, vers un commit précis, mais qui n'avance jamais toute seule contrairement à une branche). Un objet devenu inatteignable (par exemple après suppression d'une branche, si rien d'autre ne pointe vers ses commits) devient un candidat légitime à la suppression.

**`git gc`** (*garbage collection*, parfois accompagné d'un *repack*) — supprime les objets inatteignables et réorganise le stockage des autres pour plus d'efficacité. Dans ce projet, la question était de savoir s'il fallait interdire ce nettoyage sur un dépôt applicatif actif — la réponse retenue est non, à condition qu'un tag protège chaque commit qui doit être retenu indéfiniment (bijection source/load exigée par l'IG) : voir [Rétention et purge des objets git](architecture/resilience/service-synchronisation.md#retention-et-purge-des-objets-git).

**`git fsck`** (*file system check*) — parcourt l'intégralité de la base d'objets d'un dépôt et signale tout objet corrompu ou orphelin. Plus complet que `git status` (voir [Les commandes de base](#les-commandes-de-base-deja-connues)), mais aussi bien plus coûteux, puisqu'il vérifie tous les objets du dépôt partagé — pas seulement les fichiers d'une branche précise. C'est pour cette raison qu'il a été écarté au profit de `git status --porcelain` pour la vérification de propreté à la demande d'un consommateur : voir [Vérification de la propreté](architecture/resilience/detection-defauts.md#verification-de-la-proprete-integrite-du-contenu).

## Tableau récapitulatif {: #tableau-recapitulatif }

| Commande | Palier | Utilisée dans ce projet |
|---|---|---|
| `git push` | Bases | [Cycle de vie d'une branche](architecture/resilience/service-synchronisation.md#cycle-de-vie-dune-branche) |
| `git pull` *(jamais utilisée — citée en contraste)* | Bases | [Cycle de vie d'une branche](architecture/resilience/service-synchronisation.md#cycle-de-vie-dune-branche) |
| `git fetch` | Bases | [Cycle de vie d'une branche](architecture/resilience/service-synchronisation.md#cycle-de-vie-dune-branche) |
| `git status` / `--porcelain` | Bases | [Vérification de la propreté](architecture/resilience/detection-defauts.md#verification-de-la-proprete-integrite-du-contenu) |
| `git diff` | Bases | [Vérification de la propreté](architecture/resilience/detection-defauts.md#verification-de-la-proprete-integrite-du-contenu) |
| `git -C <chemin> ...` | Piloter à distance | Toutes les commandes ci-dessus, appliquées à un workspace précis |
| `git rev-parse HEAD` | Commit et HEAD | [Vérification de l'état ISO](architecture/gestion-incidents.md#verification-de-letat-iso) |
| `git reset --hard <commit>` | Destructif | [Cycle de vie d'une branche](architecture/resilience/service-synchronisation.md#cycle-de-vie-dune-branche) |
| `git worktree add` | Worktree | [Cycle de vie d'une branche](architecture/resilience/service-synchronisation.md#cycle-de-vie-dune-branche) |
| `git worktree remove` | Worktree | [Rétention et purge des objets git](architecture/resilience/service-synchronisation.md#retention-et-purge-des-objets-git) |
| `git gc` / repack | Object store | [Rétention et purge des objets git](architecture/resilience/service-synchronisation.md#retention-et-purge-des-objets-git) |
| `git fsck` | Object store | [Vérification de la propreté](architecture/resilience/detection-defauts.md#verification-de-la-proprete-integrite-du-contenu) |
