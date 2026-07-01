# Catalogue des pannes et conséquences

!!! info "Prérequis"
    Cette page suppose une connaissance des mécanismes de détection décrits dans [Détection et gestion des défauts de synchro](detection-defauts.md) et du runbook associé dans [Gestion des incidents et reprise](../gestion-incidents.md).

Un défaut de synchro peut avoir des origines très différentes : panne d'un composant, bug applicatif ciblé sur une seule branche, saturation d'une ressource, dérive de configuration. Cette page récapitule les causes identifiées à ce stade, comment chacune se détecte, ce qu'elle bloque **réellement** (et ce qu'elle ne bloque pas), et comment on en sort.

## Vue d'ensemble

| Cause | Détection | CI/CD impactée ? | Reprise |
|---|---|---|---|
| [GitLab en panne](#gitlab-en-panne) | Immédiate côté GitLab lui-même — hors du périmètre du service de sync | Oui, aujourd'hui, sauf procédure dégradée manuelle | Automatique au retour de GitLab (webhooks en attente rejoués) |
| [zCX (service de sync) en panne](#zcx-service-de-sync-en-panne) | Heartbeat DB2 (`SYNC_SERVICE_HEARTBEAT`), sous ~20 minutes | Non — synchro découplée du pipeline | Automatique si la panne dure moins de ~3h30 ; manuelle au-delà |
| [DB2 ou DRS indisponible alors que zCX fonctionne](#db2-ou-drs-indisponible-alors-que-zcx-fonctionne) | Heartbeat si l'indisponibilité dépasse ~20 minutes (même canal DRS) ; en dessous, non détectée | Non | À définir pour le cas bref — point ouvert |
| [Panne côté z/OS](#panne-cote-zos) | Supervision infra existante | Dépend de la topologie du service de sync (point ouvert) | Bascule HA si la topologie est résolue ; sinon manuelle |
| [Bug applicatif ciblé sur une branche](#bug-applicatif-cible-sur-une-branche) | Non détecté par le heartbeat (global) — seulement par la réconciliation, à sa cadence | Non — seule la branche concernée est en retard | Automatique à la prochaine réconciliation |
| [Saturation ou corruption du stockage USS](#saturation-ou-corruption-du-stockage-uss) | Non couvert explicitement à ce stade | Potentiellement, si un pipeline lit directement USS (voir [Perspectives](../../perspectives.md#optimisation-potentielle-de-la-chaine-de-build)) | À définir — point ouvert |
| [Dérive de configuration côté GitLab](#derive-de-configuration-cote-gitlab) | Aucune avant la prochaine réconciliation | Non | Automatique à la prochaine réconciliation, une fois la configuration corrigée |

## GitLab en panne

**Ce qui est bloqué : uniquement ce qui a besoin d'écrire sur GitLab ou d'appeler son API en direct** — nouveaux commits, créations de branches, et l'étape de création de branches de la [recompilation de masse](../../perspectives.md#recompilation-de-masse-du-patrimoine).

**Ce qui continue de fonctionner : tout ce qui ne fait que lire l'état déjà synchronisé sur USS.** C'est le principe même du miroir réglementaire (voir [La contrainte de départ](index.md#la-contrainte-de-depart)) : la chaîne de build optimisée, la prise d'image du patrimoine, l'archivage, la sauvegarde DORA — tous lisent USS, pas GitLab en direct, et ne sont donc pas affectés par cette panne.

!!! note "Nuance : l'état actuel des pipelines diffère de la cible"
    **Aujourd'hui**, les pipelines CI/CD tirent les sources depuis GitLab (le transfert décrit dans [Optimisation potentielle de la chaîne de build](../../perspectives.md#optimisation-potentielle-de-la-chaine-de-build) n'est pas encore en place) — ils *sont* donc bloqués par une panne GitLab, et c'est précisément le rôle de la [procédure dégradée](../gestion-incidents.md#mode-degrade-panne-gitlab) de permettre de continuer à builder, promouvoir et déployer manuellement depuis le dernier état synchronisé. Le jour où cette optimisation sera implémentée, les pipelines deviendront naturellement immunisés contre une panne GitLab, sans procédure dégradée à déclencher.

La reprise est automatique dès le retour de GitLab : les webhooks mis en attente pendant la panne sont rejoués selon le calendrier de relance habituel (voir [Le service de synchronisation](service-synchronisation.md)), sans action manuelle sur la synchro elle-même — seules les actions exécutées en mode dégradé doivent être reportées manuellement dans GitLab, comme le décrit [Mode dégradé — panne GitLab](../gestion-incidents.md#mode-degrade-panne-gitlab).

## zCX (service de sync) en panne

**La CI/CD n'est pas bloquée** : [Le service de synchronisation](service-synchronisation.md) est explicitement découplé du pipeline de build. Un pipeline qui construit depuis GitLab (le mode actuel) continue de fonctionner normalement — seul USS prend du retard pendant la panne.

**La reprise après une panne d'1 heure est déjà automatique**, sans procédure particulière : la fenêtre de grâce des relances GitLab est d'environ **3h30** (1 + 5 + 10 + 100 + 100 minutes, voir [Incident sur zCX](../gestion-incidents.md#incident-sur-zcx-que-se-passe-t-il-pendant-la-panne)). Une panne d'1 heure reste largement dans cette fenêtre : au redémarrage du service, GitLab rejoue automatiquement les webhooks en attente et USS se resynchronise tout seul. La procédure manuelle de vérification décrite dans la gestion des incidents ne devient nécessaire qu'au-delà de ~3h30 de panne.

## DB2 ou DRS indisponible alors que zCX fonctionne

Cas distinct d'une panne zCX totale : le container est vivant, il reçoit bien les webhooks GitLab, mais l'écriture dans `SYNC_STATUS` échoue (DRS injoignable, verrou DB2, timeout). Si l'indisponibilité de DRS se prolonge au-delà du seuil d'alerte, le heartbeat finit par la détecter comme une panne classique — le ping vers `SYNC_SERVICE_HEARTBEAT` emprunte le même canal DRS et échoue donc lui aussi. Mais pour une indisponibilité brève (quelques secondes à quelques minutes, sous le seuil d'alerte), le comportement à adopter n'est pas encore précisé :

- Le webhook doit-il échouer volontairement (répondre un code non-2xx) pour forcer GitLab à le rejouer plus tard, une fois DB2/DRS de nouveau disponible ?
- Ou l'opération `git worktree`/`reset --hard` doit-elle malgré tout être effectuée sur USS, quitte à laisser `SYNC_STATUS` provisoirement désynchronisé (au risque de fausser le verrou de synchro côté consommateur pour cette branche précise) ?

C'est un point ouvert, voir [Comportement quand DB2/DRS est indisponible alors que zCX fonctionne](../../points-ouverts.md#comportement-quand-db2drs-est-indisponible-alors-que-zcx-fonctionne).

## Panne côté z/OS

Deux cas très différents à distinguer :

- **Panne d'un seul datacenter** : elle doit être absorbée par la haute disponibilité déjà en place entre les deux datacenters (voir [Impact sur l'architecture globale](index.md#impact-sur-larchitecture-globale)) — à condition que la topologie du service de sync (actif/actif ou actif/passif) soit tranchée, ce qui reste un [point ouvert](../../points-ouverts.md#topologie-du-service-de-sync-entre-les-deux-datacenters). Sans bascule automatique déjà définie, une intervention de l'exploitant reste nécessaire.
- **Panne des deux datacenters simultanément** : hors périmètre de cette documentation — ce scénario relève du plan de continuité et de reprise d'activité global de la banque, pas spécifiquement de ce projet de miroir USS.

## Bug applicatif ciblé sur une branche

Le service de sync tourne normalement, traite le flux global d'événements sans interruption — son signal de vie dans `SYNC_SERVICE_HEARTBEAT` (voir [Heartbeat DB2](detection-defauts.md#heartbeat-db2-detection-quasi-temps-reel)) continue donc d'avancer. Mais un événement particulier peut échouer silencieusement : caractère non géré dans un nom de branche au-delà du simple `/`, timeout git sur un dépôt volumineux, ou race condition entre deux webhooks quasi simultanés sur la même branche.

**Le heartbeat DB2 ne détecte pas ce cas** : il mesure la vivacité du service dans son ensemble (un signal de vie émis sur son propre timer), pas le traitement correct de chaque événement individuel. Seule la [réconciliation périodique](detection-defauts.md#reconciliation-periodique) rattrape ce cas, à sa cadence — potentiellement une fois par jour dans le régime allégé décrit dans cette même section. C'est un angle mort assumé du heartbeat, compensé par la réconciliation plutôt que par une détection en temps réel dédiée.

## Saturation ou corruption du stockage USS

Disque plein sur `/u/gitlab`, corruption d'objets git, verrou zFS bloquant un `git worktree` — dans ce cas, GitLab, zCX et DB2 fonctionnent tous normalement, mais l'opération échoue côté USS lui-même. Le comportement à adopter n'est pas encore précisé :

- Comment cette classe d'échec est-elle distinguée, côté supervision, d'un échec applicatif transitoire (réseau, timeout) qui se résorbe tout seul au prochain webhook ou à la prochaine réconciliation ?
- Une alerte dédiée à la santé du stockage USS (espace disque, intégrité des objets git) est-elle nécessaire en plus du heartbeat DB2, qui ne surveille que l'écriture en base ?

C'est un point ouvert, voir [Détection de la saturation ou de la corruption du stockage USS](../../points-ouverts.md#detection-de-la-saturation-ou-de-la-corruption-du-stockage-uss).

## Dérive de configuration côté GitLab

Secret de webhook expiré ou changé sans mise à jour côté zCX, webhook désactivé par erreur, permissions du compte de service GitLab révoquées : rien n'est "en panne" au sens infrastructure, mais plus aucun webhook n'est émis ou accepté. Ce cas est déjà indirectement couvert par le point ouvert [Sécurisation des échanges avec GitLab](../../points-ouverts.md#securisation-des-echanges-avec-gitlab), mais mérite d'être nommé explicitement ici comme cause de désynchro : sans webhook entrant valide, seule la réconciliation périodique — à sa cadence, potentiellement journalière — permet de s'en apercevoir.
