# Catalogue des pannes et conséquences

!!! info "Prérequis"
    Cette page suppose une connaissance des mécanismes de détection décrits dans [Détection et gestion des défauts de synchro](detection-defauts.md) et du runbook associé dans [Gestion des incidents et reprise](../gestion-incidents.md).

Un défaut de synchro peut avoir des origines très différentes : panne d'un composant, bug applicatif ciblé sur une seule branche, saturation d'une ressource, dérive de configuration. Cette page récapitule les causes identifiées à ce stade, comment chacune se détecte, ce qu'elle bloque **réellement** (et ce qu'elle ne bloque pas), et comment on en sort.

## Vue d'ensemble

Le tableau ci-dessous résume, pour chaque cause : comment elle se détecte, si la CI/CD est impactée, et comment on en sort.

| Cause | Détection | CI/CD impactée ? | Reprise |
|---|---|---|---|
| [GitLab en panne](#gitlab-en-panne) | Immédiate côté GitLab lui-même — hors du périmètre du service de sync | Oui, aujourd'hui, sauf procédure dégradée manuelle | Automatique au retour de GitLab (webhooks en attente rejoués) |
| [zCX (service de sync) en panne](#zcx-service-de-sync-en-panne) | Heartbeat DB2 (`SYNC_SERVICE_HEARTBEAT`), sous ~20 minutes | Non — synchro découplée du pipeline | Automatique si la panne dure moins de ~3h36 ; manuelle au-delà |
| [DB2 ou DRS indisponible alors que zCX fonctionne](#db2-ou-drs-indisponible-alors-que-zcx-fonctionne) | Heartbeat si l'indisponibilité dépasse ~20 minutes (même canal DRS) ; en dessous, non détectée | Non | Automatique — webhook rejoué par GitLab dès que DB2/DRS répond de nouveau |
| [Panne côté z/OS](#panne-cote-zos) | Supervision infra existante (exploitant) | Non, sur panne d'un seul datacenter — bascule actif/passif automatique du service de sync | Automatique (bascule technique quasi instantanée) ; validation opérationnelle manuelle (~2h) avant confiance totale |
| [Bug applicatif ciblé sur une branche](#bug-applicatif-cible-sur-une-branche) | Non détecté par le heartbeat (global) — seulement par la réconciliation, à sa cadence | Non — seule la branche concernée est en retard | Automatique à la prochaine réconciliation |
| [Saturation ou corruption du stockage USS](#saturation-ou-corruption-du-stockage-uss) | Saturation : supervision infra existante (hors périmètre projet) ; corruption : `SYNC_STATUS` bloqué à `PENDING` au-delà du seuil d'alerte (même mécanisme que DB2/DRS) | Potentiellement, si un pipeline lit directement USS (voir [Perspectives](../../perspectives.md#optimisation-potentielle-de-la-chaine-de-build)) | Automatique si transitoire (résorbé pendant la fenêtre de relance GitLab) ; manuelle au-delà |
| [Dérive de configuration côté GitLab](#derive-de-configuration-cote-gitlab) | Aucune avant la prochaine réconciliation | Non | Automatique à la prochaine réconciliation, une fois la configuration corrigée |

## GitLab en panne

**Ce qui est bloqué : uniquement ce qui a besoin d'écrire sur GitLab ou d'appeler son API en direct** — nouveaux commits, créations de branches, et l'étape de création de branches de la [recompilation de masse](../../perspectives.md#recompilation-de-masse-du-patrimoine).

**Ce qui continue de fonctionner : tout ce qui ne fait que lire l'état déjà synchronisé sur USS.** C'est le principe même du miroir réglementaire (voir [La contrainte de départ](index.md#la-contrainte-de-depart)) : la chaîne de build optimisée, la prise d'image du patrimoine, l'archivage, la sauvegarde DORA — tous lisent USS, pas GitLab en direct, et ne sont donc pas affectés par cette panne.

!!! note "Nuance : l'état actuel des pipelines diffère de la cible"
    **Aujourd'hui**, les pipelines CI/CD tirent les sources depuis GitLab (le transfert décrit dans [Optimisation potentielle de la chaîne de build](../../perspectives.md#optimisation-potentielle-de-la-chaine-de-build) n'est pas encore en place) — ils *sont* donc bloqués par une panne GitLab, et c'est précisément le rôle de la [procédure dégradée](../gestion-incidents.md#mode-degrade-panne-gitlab) de permettre de continuer à builder, promouvoir et déployer manuellement depuis le dernier état synchronisé. Le jour où cette optimisation sera implémentée, les pipelines deviendront naturellement immunisés contre une panne GitLab, sans procédure dégradée à déclencher.

La reprise est automatique dès le retour de GitLab : les webhooks mis en attente pendant la panne sont rejoués selon le calendrier de relance habituel (voir [Le service de synchronisation](service-synchronisation.md)), sans action manuelle sur la synchro elle-même — seules les actions exécutées en mode dégradé doivent être reportées manuellement dans GitLab, comme le décrit [Mode dégradé — panne GitLab](../gestion-incidents.md#mode-degrade-panne-gitlab).

## zCX (service de sync) en panne

**La CI/CD n'est pas bloquée** : [Le service de synchronisation](service-synchronisation.md) est explicitement découplé du pipeline de build. Un pipeline qui construit depuis GitLab (le mode actuel) continue de fonctionner normalement — seul USS prend du retard pendant la panne.

**La reprise après une panne d'1 heure est déjà automatique**, sans procédure particulière : la fenêtre de grâce des relances GitLab est d'environ **3h36** (1 + 5 + 10 + 100 + 100 minutes, voir [Incident sur zCX](../gestion-incidents.md#incident-sur-zcx-que-se-passe-t-il-pendant-la-panne)). Une panne d'1 heure reste largement dans cette fenêtre : au redémarrage du service, GitLab rejoue automatiquement les webhooks en attente et USS se resynchronise tout seul. La procédure manuelle de vérification décrite dans la gestion des incidents ne devient nécessaire qu'au-delà de ~3h36 de panne.

## DB2 ou DRS indisponible alors que zCX fonctionne

Cas distinct d'une panne zCX totale : le container est vivant, il reçoit bien les webhooks GitLab, mais l'écriture dans `SYNC_STATUS` échoue (DRS injoignable, verrou DB2, time-out). Si l'indisponibilité de DRS se prolonge au-delà du seuil d'alerte, le heartbeat finit par la détecter comme une panne classique — le ping vers `SYNC_SERVICE_HEARTBEAT` emprunte le même canal DRS et échoue donc lui aussi. Reste le cas d'une indisponibilité **brève** (quelques secondes à quelques minutes, sous le seuil d'alerte).

**Décision retenue : le webhook échoue volontairement (code non-2xx), quelle que soit l'étape où DB2/DRS a fait défaut** — avant même l'écriture de `PENDING`, ou après un [`reset --hard`](../../commandes-git.md#reset-hard-une-commande-destructive-volontairement) réussi mais avant l'écriture de `READY`. Ce n'est pas un mécanisme nouveau à construire : c'est une application directe de la règle déjà posée dans [Cycle de vie d'une branche](service-synchronisation.md#cycle-de-vie-dune-branche) — un `2xx` n'est renvoyé à GitLab **qu'après le succès complet de toute la chaîne** (écriture `PENDING`, opération git, journal, écriture `READY`). Une indisponibilité DB2/DRS, même brève, est donc traitée exactement comme n'importe quel autre échec intermédiaire, sans cas particulier à coder.

Deux propriétés déjà établies rendent ce choix sûr :

- **Le script est idempotent** (voir [Amorçage initial et idempotence](service-synchronisation.md#cycle-de-vie-dune-branche)) : rejouer le même webhook après l'incident — que le `reset --hard` ait déjà eu lieu ou non — converge vers le même état final, sans risque de double effet.
- **`SYNC_STATUS` ne se retrouve jamais faussé** : si l'échec survient après un `reset --hard` réussi mais avant l'écriture de `READY`, la ligne reste à `PENDING` — ce qui est *correct*, puisque la synchro n'est en effet pas encore confirmée de bout en bout. Un consommateur qui vérifie le statut continue donc d'attendre, plutôt que de lire une valeur trompeuse.

L'alternative (effectuer quand même l'opération USS et laisser `SYNC_STATUS` provisoirement désynchronisé) aurait cassé la garantie même que le verrou de synchro existe pour fournir — elle n'est pas retenue.

Si l'indisponibilité dépasse la fenêtre de relance GitLab (~3h36) sans que DB2/DRS ne revienne, `SYNC_STATUS` reste à `PENDING` au-delà du seuil d'alerte (même principe que le heartbeat, voir [Vérification côté consommateur](detection-defauts.md#verification-cote-consommateur-verrou-de-synchro)) — détecté par la même supervision, sans mécanisme dédié supplémentaire.

## Panne côté z/OS

Deux cas très différents à distinguer :

- **Panne d'un seul datacenter** : elle doit être absorbée par la haute disponibilité déjà en place entre les deux datacenters (voir [Impact sur l'architecture globale](index.md#impact-sur-larchitecture-globale)), avec le service de sync lui-même en topologie actif/passif et bascule automatique (voir [Topologie retenue](index.md#impact-sur-larchitecture-globale)). Un précédent réel confirme la bascule technique quasi instantanée, mais avec une validation opérationnelle de l'ordre de deux heures avant confiance totale — voir la note dédiée sur la page d'index.
- **Panne des deux datacenters simultanément** : hors périmètre de cette documentation — ce scénario relève du plan de continuité et de reprise d'activité global de la banque, pas spécifiquement de ce projet de miroir USS.

## Bug applicatif ciblé sur une branche

Le service de sync tourne normalement, traite le flux global d'événements sans interruption — son signal de vie dans `SYNC_SERVICE_HEARTBEAT` (voir [Heartbeat DB2](detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)) continue donc d'avancer. Mais un événement particulier peut échouer silencieusement : caractère non géré dans un nom de branche au-delà du simple `/`, timeout git sur un dépôt volumineux, ou race condition entre deux webhooks quasi simultanés sur la même branche.

**Le heartbeat DB2 ne détecte pas ce cas** : il mesure la vivacité du service dans son ensemble (un signal de vie émis sur son propre timer), pas le traitement correct de chaque événement individuel. Seule la [réconciliation périodique](detection-defauts.md#reconciliation-periodique) rattrape ce cas, à sa cadence — potentiellement une fois par jour dans le régime allégé décrit dans cette même section. C'est un angle mort assumé du heartbeat, compensé par la réconciliation plutôt que par une détection en temps réel dédiée.

## Saturation ou corruption du stockage USS

Disque plein sur `/u/gitlab`, corruption d'objets git, verrou zFS bloquant un `git worktree` — dans ce cas, GitLab, zCX et DB2 fonctionnent tous normalement, mais l'opération échoue côté USS lui-même.

**La saturation d'espace disque est déjà couverte, hors de ce projet** : l'administration z/OS est assurée globalement par l'exploitant, qui dispose déjà d'une supervision et d'un alerting sur les espaces disques (au même titre que le reste du stockage z/OS) — même principe que la haute disponibilité infrastructure, déjà couverte nativement sans dispositif spécifique à concevoir ici (voir [Impact sur l'architecture globale](index.md#impact-sur-larchitecture-globale) et [Périmètre du projet et responsabilités](../index.md#infrastructure-z-os-a-la-charge-de-lexploitant)). Il n'y a donc pas d'alerte dédiée à construire pour ce cas précis : c'est un signal qui existe déjà, sur un périmètre plus large que ce seul projet.

Reste le cas plus spécifique d'une **corruption d'objets git ou d'un verrou zFS bloquant**, qu'une alerte générique sur l'espace disque ne peut pas voir (le disque a de la place, l'opération échoue quand même). Ce cas ne demande cependant pas de nouveau mécanisme de détection : il est déjà couvert par une règle posée ailleurs dans cette documentation.

**Décision retenue : aucun dispositif de détection dédié à concevoir — ce cas se comporte exactement comme une indisponibilité DB2/DRS.**

L'opération USS ([`git worktree add`](../../commandes-git.md#worktree-plusieurs-repertoires-de-travail-pour-un-seul-depot)/[`fetch`](../../commandes-git.md#les-commandes-de-base-deja-connues)/`reset --hard`) fait partie intégrante de la chaîne dont dépend le `2xx` renvoyé à GitLab, au même titre que l'écriture DB2 (voir [Comportement décidé pour DB2/DRS indisponible](#db2-ou-drs-indisponible-alors-que-zcx-fonctionne) juste au-dessus) : un échec côté USS empêche donc la réponse `2xx`, exactement comme un échec DB2/DRS. Les deux mécanismes déjà en place répondent alors sans rien ajouter :

- **Le cas transitoire se résorbe tout seul** : GitLab rejoue le webhook selon son calendrier habituel (jusqu'à ~3h36), et un verrou zFS momentané ou un pic d'I/O disparaît généralement avant la fin de cette fenêtre — sans qu'aucune alerte ne se déclenche, exactement comme n'importe quel autre échec transitoire déjà décrit sur cette page.
- **Le cas persistant (corruption réelle, verrou qui ne se libère jamais) laisse `SYNC_STATUS` bloqué à `PENDING`** au-delà du seuil d'alerte — le même signal, déjà posé dans [Vérification côté consommateur](detection-defauts.md#verification-cote-consommateur-verrou-de-synchro), qui couvre "un service de sync mort en cours d'opération sur cette branche précise". Une corruption d'objets git en est une cause parmi d'autres, pas un cas à distinguer explicitement au niveau de la supervision.

Ce qui distingue donc un échec transitoire d'un échec persistant n'est jamais la *nature* de la panne (réseau, DB2/DRS, disque, corruption git) — c'est uniquement sa **durée**, mesurée par le même seuil `PENDING` déjà en place. Ajouter une alerte dédiée à l'intégrité des objets git dupliquerait ce mécanisme sans rien détecter de plus tôt.

## Dérive de configuration côté GitLab

Secret de webhook expiré ou changé sans mise à jour côté zCX, webhook désactivé par erreur, permissions du compte de service GitLab révoquées : rien n'est « en panne » au sens infrastructure, mais plus aucun webhook n'est émis ou accepté. Le mécanisme de vérification du secret webhook est désormais couvert (voir [Sécurisation du webhook entrant](service-synchronisation.md#securisation-du-webhook-entrant)), de même que l'expiration et le renouvellement du jeton de service utilisé côté réconciliation (voir [Sécurisation de l'appel sortant vers l'API GitLab](detection-defauts.md#securisation-de-lappel-sortant-vers-lapi-gitlab)). Ce cas mérite d'être nommé explicitement ici comme cause de désynchro : sans webhook entrant valide, seule la réconciliation périodique — à sa cadence, potentiellement journalière — permet de s'en apercevoir.
