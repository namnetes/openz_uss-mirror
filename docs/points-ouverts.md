# Points non couverts

!!! warning "Page de suivi"
    Cette page recense trois familles de contenu à tenir à jour au fil des décisions : des questions d'architecture identifiées mais non encore tranchées, des constats de fiabilité technique issus d'une analyse récente, et des points de conformité réglementaire à formaliser. Une fois une question résolue, son contenu migre vers la page concernée (`architecture/resilience/`, `gestion-incidents.md`, `perspectives.md`, `conformite-reglementaire.md`) et l'entrée est retirée d'ici.

!!! info "Prérequis"
    Cette page suppose une connaissance des mécanismes déjà posés dans [Résilience et synchronisation USS](architecture/resilience/index.md) et [Détection et gestion des défauts de synchro](architecture/resilience/detection-defauts.md) : DRS, RACF, heartbeat DB2, réconciliation périodique.

## Priorités

Pour un lecteur pressé : les deux points les plus critiques de cette page sont l'absence de RTO et de RPO formellement engagés pour le service de synchronisation — priorité la plus haute, à la fois sous l'angle technique et sous l'angle réglementaire DORA art. 12 (voir [Fiabilité du dispositif de mitigation](#fiabilite-du-dispositif-de-mitigation-constats-de-lanalyse-technique) et [Conformité réglementaire à formaliser](#conformite-reglementaire-a-formaliser)) — et la vérification à mener auprès de la fonction conformité sur une éventuelle notification ACPR (même section). Le reste de cette page peut attendre un arbitrage sans urgence comparable.

## Constats de fiabilité et de conformité

### Cadrage du SLA 99,99 % et dispositif de mitigation

Le [SLA](glossaire.md#sla) de 99,99 % visé par la plateforme porte sur la disponibilité globale du Mainframe et de ses applications — un niveau historiquement assuré nativement par l'infrastructure z/OS — et non sur le service de synchronisation USS pris isolément.

Le miroir USS a pour rôle de préserver ce SLA global en absorbant les indisponibilités de GitLab (une infrastructure externe au périmètre z/OS) via le mode dégradé : tant que GitLab répond, le mécanisme de synchronisation fonctionne normalement ; s'il tombe, USS permet de continuer à builder, promouvoir et déployer depuis le dernier état synchronisé, sans que cette panne externe ne se répercute sur la disponibilité perçue des applications Mainframe.

La vraie question de disponibilité à trancher n'est donc pas « le service de sync tient-il 99,99 % ? » mais « le mode dégradé se déclenche-t-il assez vite et de façon assez fiable pour que l'indisponibilité de GitLab ne se répercute jamais sur la disponibilité perçue des applications Mainframe elles-mêmes ? ». C'est cette question — la fiabilité du dispositif de mitigation lui-même — qui structure la section suivante.

### Fiabilité du dispositif de mitigation (constats de l'analyse technique)

Une analyse technique récente de l'architecture de résilience, menée au regard du SLA cadré ci-dessus, a mis en évidence plusieurs zones d'ombre sur la fiabilité du mode dégradé lui-même — c'est-à-dire sur sa capacité à effectivement absorber une indisponibilité de GitLab sans délai ni échec :

- Aucun [RTO](glossaire.md#rto) ni [RPO](glossaire.md#rpo) n'est formellement engagé pour le service de synchronisation ni pour la procédure de resynchronisation — les seuls chiffres documentés (heartbeat, fenêtre de grâce GitLab, cadence de réconciliation) sont des délais de détection, jamais des engagements de résolution. Le gabarit à compléter une fois ces valeurs déterminées est fourni ci-dessous.
- Aucune auto-remédiation n'est prévue : rien n'indique que le container zCX redémarre automatiquement en cas de panne, ce qui fait reposer toute reprise sur une intervention humaine.
- Cette intervention humaine repose sur un opérateur sans astreinte, MTTA/MTTR ni couverture horaire documentés ; le canal d'alerte actuel (BAL email) est potentiellement inadapté à un besoin de réaction urgente.
- La bascule d'infrastructure (LPAR, stockage, réseau) est déjà couverte par des exercices [PSI](glossaire.md#psi-plan-de-secours-informatique) (*Plan de Secours Informatique*) réguliers, menés dans les deux sens entre les deux datacenters — le futur service de sync en bénéficiera nativement, puisqu'il sera hébergé sur une LPAR sécurisée elle-même ciblée par ces exercices.
- Ce que les PSI valident, c'est la bascule de l'infrastructure elle-même (la LPAR redémarre-t-elle correctement sur l'autre site) — pas le comportement fonctionnel du service de sync pendant cette bascule : le heartbeat détecte-t-il correctement l'interruption, les webhooks GitLab en attente sont-ils correctement rejoués après bascule, la réconciliation périodique rattrape-t-elle un éventuel écart créé pendant la fenêtre de bascule. Cette validation fonctionnelle ne pourra se faire qu'une fois le service développé — idéalement en l'intégrant à un prochain cycle de PSI plutôt qu'en la laissant hors périmètre. L'estimation « resynchronisation complète sous la minute par application, pour ~600 applications » (voir [Resynchronisation complète](architecture/gestion-incidents.md#resynchronisation-complete)) reste elle aussi un calcul théorique non testé, et raisonné par application plutôt que sur un total exhaustif toutes branches confondues — mais elle concerne la performance du service applicatif, pas la bascule d'infrastructure.
- La capacité de montée en charge du service de sync n'est pas modélisée : aucun débit maximal, aucune stratégie d'absorption de pic (ex. déclenché par une recompilation de masse générant de nombreux événements en rafale) n'est documentée.
- Aucun monitoring applicatif réel n'existe au-delà de l'alerte binaire du heartbeat : pas de tableau de bord, pas de suivi de budget d'erreur, pas de télémétrie sur l'âge du dernier événement traité par branche.
- La cadence de réconciliation (« potentiellement journalière ») reste à réévaluer : c'est le seul filet de rattrapage pour un bug applicatif ciblé ou une dérive de configuration GitLab, avec un délai de correction potentiel de plusieurs heures.

Ni le RTO ni le RPO ne peuvent être fixés par une estimation technique unilatérale : ce sont des arbitrages qui engagent l'organisation (comité de pilotage, fonction risques/conformité), au regard de la criticité réelle de la fonction concernée — pas une valeur que l'équipe technique peut choisir seule. Une fois ces valeurs formellement déterminées, elles doivent être consignées ci-dessous avec la date et l'instance qui les a validées, avant de migrer vers une page définitive ([Gestion des incidents et reprise](architecture/gestion-incidents.md) pour l'engagement opérationnel, ou [Périmètre du projet et responsabilités](architecture/index.md#perimetre-du-projet-et-responsabilites) pour son rattachement au périmètre applicatif du service de sync) — conformément à la règle de vie de cette page : une question résolue migre et est retirée d'ici.

```
RTO à déterminer : _______ (non défini à ce jour)
RPO à déterminer : _______ (non défini à ce jour)
Périmètre : service de synchronisation USS uniquement (voir Périmètre du projet et responsabilités)
Validé par : _______
Date : _______
```

La [vérification d'écart avant bascule en mode dégradé](architecture/gestion-incidents.md#verification-prealable-a-la-bascule-en-mode-degrade-ecart-de-synchro-et-sante-du-mecanisme), désormais prévue dans le runbook, fournira une mesure exploitable pour cet arbitrage le moment venu — elle ne le remplace pas, et ne dispense pas de le formaliser.

### Conformité réglementaire à formaliser

Une analyse de conformité multi-niveaux (voir [Conformité réglementaire](conformite-reglementaire.md)) a identifié quatre points à traiter formellement, indépendamment des questions déjà listées ci-dessus :

- **RTO et RPO à engager formellement** pour le service de synchronisation et sa procédure de resynchronisation, au titre de l'article 12 de DORA — priorité la plus haute de cette section, à recouper avec les lacunes déjà listées dans [Fiabilité du dispositif de mitigation](#fiabilite-du-dispositif-de-mitigation-constats-de-lanalyse-technique) ci-dessus (absence de RTO/RPO déjà notée sous l'angle technique, ici sous l'angle réglementaire).
- **Vérification à mener auprès de la fonction conformité** sur une éventuelle notification ACPR (instruction 2020-I-09) et une politique d'externalisation écrite couvrant l'usage de GitLab — non tranchée côté équipe technique, sans que cela signifie une absence de démarche menée ailleurs dans l'établissement.
- **Cartographie formelle des interdépendances** (principe n° 4 des *Principles for Operational Resilience* du Comité de Bâle, BCBS 561) reliant les opérations métier critiques à la chaîne complète de leurs dépendances techniques — non produite à ce stade.
- **RGPD — durée de conservation précise et base légale à documenter**, par catégorie de donnée personnelle, pour le journal de synchronisation, le journal de mode dégradé et les métadonnées Git conservés indéfiniment — voir l'analyse complète dans [Conformité réglementaire](conformite-reglementaire.md#rgpd-conservation-des-donnees-personnelles). Ce n'est pas la conservation longue elle-même qui est en cause, mais l'absence d'une durée précise et d'une base légale documentée par la fonction conformité/DPO.

## Questions d'architecture à trancher

### Restreindre les caractères autorisés dans un nom de branche

[Cycle de vie d'une branche](architecture/resilience/service-synchronisation.md#cycle-de-vie-dune-branche) part du principe qu'un nom de branche GitLab peut contenir à peu près n'importe quel caractère valide en Git, `/` inclus, et documente la conversion systématique de ce `/` en `-`. Mais rien dans ce corpus n'établit que cet usage du `/` corresponde à une pratique réellement répandue aujourd'hui plutôt qu'à un exemple illustratif — la CI existante n'a, à ce jour, jamais eu à trancher explicitement cette question.

**Option envisagée : imposer une liste blanche de caractères autorisés** — `a-z`, `A-Z`, `0-9`, `-`, `_` — via le mécanisme natif [**Push Rules**](https://docs.gitlab.com/ee/user/project/repository/push_rules.html) de GitLab (`Settings → Repository → Push Rules → Branch name`, une regex appliquée côté serveur, valable pour tout canal de création de branche : CLI, Web IDE, API). L'intérêt : fermer par construction, à la création de la branche, le risque déjà identifié dans [Bug applicatif ciblé sur une branche](architecture/resilience/pannes-et-consequences.md#bug-applicatif-cible-sur-une-branche) (*« caractère non géré dans un nom de branche au-delà du simple `/` »*), plutôt que de compter sur la réconciliation périodique pour le rattraper après coup.

Ce que cette option laisse en suspens :

- **Le `/` serait exclu de cette liste** — ce qui romprait la convention illustrée par les exemples `pkg/PKG-20260616-0042` et `DAY1000001/features-demo`, si elle est réellement utilisée par une ou plusieurs équipes aujourd'hui. Avant de trancher, il faut établir si cet usage du `/` reflète une pratique existante à préserver, ou seulement un exemple technique sans équivalent réel — une question de fait, pas d'architecture.
- **Push Rules est une fonctionnalité de palier Premium/Ultimate** de GitLab — sa disponibilité dépend de la licence effectivement souscrite par la plateforme, une contrainte hors du périmètre de ce projet de miroir.
- Si le `/` est un jour interdit, la logique de conversion `/` → `-` documentée dans [Cycle de vie d'une branche](architecture/resilience/service-synchronisation.md#cycle-de-vie-dune-branche) resterait nécessaire un temps pour les branches déjà existantes créées avant la restriction, sauf migration explicite de leur nom.

**Complément possible, en plus de la Push Rule — un hook Git côté poste développeur** : un rejet serveur intervient seulement au moment du `push`, ce qui peut être tardif si le développeur ne pousse pas rapidement après avoir nommé sa branche. Un hook local (`pre-push` ou équivalent) donnerait un retour immédiat, avant même la tentative de push. Deux limites propres à ce complément, à ne pas confondre avec la Push Rule elle-même :

- il n'est **jamais versionné par Git** (le dossier `.git/hooks/` n'est pas commité) — son déploiement sur l'ensemble des postes suppose un mécanisme de distribution à part (template Git global, `core.hooksPath` d'entreprise, outil dédié type Husky), un sujet d'outillage poste de travail distinct de ce projet de miroir ;
- il reste **contournable** (`git push --no-verify`, ou simplement non installé) — un confort de retour rapide pour le développeur, jamais une garantie. La seule barrière qui compte réellement pour fermer le risque reste la Push Rule côté serveur, incontournable quel que soit le canal.

Cette question relève des équipes qui nomment leurs branches au quotidien (leur convention réelle) et du propriétaire de la plateforme GitLab (disponibilité de la fonctionnalité) — pas uniquement de ce projet de miroir, qui ne fait qu'hériter du nom de branche tel que GitLab le lui transmet.
