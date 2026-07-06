# Conformité réglementaire

!!! warning "Analyse technique — pas un avis juridique"
    Cette page rassemble une analyse technique et documentaire de la conformité réglementaire de l'architecture décrite dans ce projet. Elle s'appuie sur les textes officiels cités en fin de page, mais ne remplace pas une validation par la fonction conformité/juridique de l'établissement — notamment sur les points explicitement signalés « à vérifier » ci-dessous.

!!! info "Prérequis"
    Cette page suppose une connaissance du contexte général du projet ([Openz Uss Mirror](index.md)), du mécanisme de résilience USS ([Résilience et synchronisation USS](architecture/resilience/index.md)) et de la première mention de DORA dans [Perspectives et synergies](perspectives.md#reconstruction-du-si-apres-cyberattaque).

## Objectif et méthode

Cette page confronte l'architecture de résilience USS à quatre niveaux de textes et de doctrine réglementaires : le [règlement européen DORA](glossaire.md#dora), la doctrine française de l'[ACPR](glossaire.md#acpr), les référentiels internationaux/sectoriels (ISO/IEC 27001, [BCBS](glossaire.md#bcbs)), et enfin la question spécifique de la bijection source/load déjà évoquée dans [Perspectives et synergies](perspectives.md#prise-dimage-du-patrimoine-en-production).

Pour chaque niveau, la méthode est la même : vérifier le texte réel (article, date, portée), le confronter à ce que l'architecture documente déjà, et conclure sur ce qui est couvert, ce qui manque, et le niveau de risque si rien n'est fait avant mise en production. Les sources précises (nom du texte, article, date) sont listées en fin de page plutôt que dispersées dans le texte.

## DORA — niveau européen {: #dora-niveau-europeen }

Le règlement [DORA](glossaire.md#dora) (*Digital Operational Resilience Act*, Règlement (UE) 2022/2554), déjà introduit dans [Perspectives et synergies](perspectives.md#reconstruction-du-si-apres-cyberattaque), est applicable depuis le 17 janvier 2025 et s'impose directement aux établissements bancaires, sans transposition nationale nécessaire.

| Article | Objet | Exigence précise |
|---|---|---|
| Art. 5-6 | Gouvernance et cadre de gestion du risque TIC | Fonction de contrôle dédiée, audit interne périodique du dispositif |
| **Art. 9** | Protection et prévention | Politiques, procédures et contrôles documentés pour la gestion des changements TIC, garantissant que tout changement est enregistré, testé, évalué, approuvé, mis en œuvre et vérifié de façon maîtrisée |
| Art. 11 | Politique de continuité d'activité TIC | Doit permettre une reprise rapide des fonctions critiques ou importantes et des systèmes TIC |
| **Art. 12** | Plans de continuité et de reprise après sinistre | Exige la détermination d'un [RTO](glossaire.md#rto) et d'un [RPO](glossaire.md#rpo) par l'établissement, selon la criticité des fonctions, et des tests réguliers |
| Art. 17-18 | Gestion et notification des incidents majeurs | Classification, confinement, remédiation ; notification à l'autorité compétente sous 72h pour un incident majeur |
| Art. 24-25 | Tests de résilience opérationnelle numérique — socle | Programme de tests (vulnérabilité, pénétration, scénarios) au moins annuel, pour tous les établissements |
| Art. 26 | Tests avancés ([TLPT](glossaire.md#tlpt)) | Réservé aux établissements de grande taille ou systémiques répondant à des critères précis |
| Art. 28 | Stratégie de gestion du risque lié aux prestataires tiers TIC + registre d'information | Couvre tous les accords contractuels de service TIC avec un tiers, détail renforcé pour les fonctions critiques ou importantes |
| Art. 30 | Clauses contractuelles clés | Description du service, SLA chiffrés, droits d'audit, réversibilité, continuité, notification d'incident, préavis de résiliation |
| Art. 31 | Désignation des [prestataires TIC critiques](glossaire.md#prestataire-tic-critique-dora) | Réservé à un nombre restreint d'acteurs désignés par les autorités européennes de supervision |

### GitLab est-il un prestataire tiers au sens de DORA ?

La première liste des 19 prestataires TIC désignés critiques au titre de l'article 31 (publiée par les autorités européennes de supervision le 18 novembre 2025) ne comprend aucun éditeur de plateforme Git — elle porte sur les hyperscalers cloud et quelques éditeurs financiers de premier plan. **GitLab n'est donc pas un prestataire TIC critique au sens strict de l'article 31.**

Une clarification factuelle importante réduit encore le niveau de risque sur ce point précis : **GitLab est hébergé sur le cloud privé de la banque elle-même** (datacenter interne), et non en mode SaaS externe ni chez un hébergeur cloud tiers. Il n'y a donc pas d'externalisation de l'hébergement à un tiers externe au sens plein des articles 28 et 30 — la relation avec l'éditeur GitLab se limite vraisemblablement à une relation de licence et de support logiciel, d'une nature différente d'un accord d'externalisation de service.

Cette clarification **atténue** le risque identifié sur les articles 28/30, mais **ne dispense pas** d'une vérification formelle : même une relation de licence/support peut relever d'un accord TIC à documenter selon la politique interne de l'établissement, et le degré exact de dépendance (mises à jour, support éditeur, éventuels sous-traitants de l'éditeur) reste à qualifier par la fonction conformité plutôt que par l'équipe technique.

### Ce qui manque

Le point le plus critique, sans ambiguïté, est l'absence de **RTO et de RPO formellement engagés** pour le service de synchronisation et sa procédure de resynchronisation — déjà identifiée comme un angle mort technique dans [Points non couverts](points-ouverts.md#fiabilite-du-dispositif-de-mitigation-constats-de-lanalyse-technique). L'article 12 de DORA ne recommande pas cette détermination, il l'**exige** explicitement, en fonction de la criticité des fonctions concernées. Les seuls délais aujourd'hui documentés (heartbeat ~20 min, fenêtre de grâce webhook ~3h36) sont des délais de *détection*, jamais des engagements de *résolution* — ce n'est pas la même chose au regard du texte.

Ce RTO/RPO à engager porte uniquement sur le service de synchronisation lui-même — pas sur l'infrastructure z/OS sous-jacente (LPAR, réseau inter-datacenters, moteur DB2), dont la disponibilité et le RTO/RPO propres relèvent de l'exploitant, hors périmètre de ce projet (voir [Périmètre du projet et responsabilités](architecture/index.md#infrastructure-z-os-a-la-charge-de-lexploitant)).

Deux autres manques, de moindre criticité immédiate : l'absence de référence, dans ce corpus, à un registre d'information article 28 qui inclurait l'accord GitLab (probablement tenu ailleurs dans l'établissement, mais non documenté ici) ; et l'absence de citation explicite de l'article 9 pour justifier le mécanisme de traçabilité des changements déjà en place (voir [Bijection source/load](#bijection-source-load-base-reglementaire) plus bas).

**Niveau de risque** : 🔴 **Bloquant réglementaire potentiel** sur le RTO/RPO non engagé (obligation explicite et directement applicable depuis le 17 janvier 2025) ; 🟡 **bonne pratique fortement recommandée** sur la vérification du statut exact de GitLab (licence/support vs accord TIC à part entière) et sur la citation de l'article 9.

## ACPR et doctrine française {: #acpr-doctrine-francaise }

Au niveau français, deux textes encadrent la question indépendamment de DORA :

- L'**arrêté du 3 novembre 2014** relatif au contrôle interne des entreprises du secteur bancaire (modifié en dernier lieu par l'arrêté du 25 février 2021) définit le risque informatique et exige *« un processus de gestion des changements informatiques garantissant que les modifications apportées aux systèmes d'information sont enregistrées, testées, évaluées, approuvées et mises en œuvre »* — la formulation française la plus proche de l'article 9 de DORA, antérieure à ce dernier et toujours en vigueur comme socle national du contrôle interne.
- L'**instruction [ACPR](glossaire.md#acpr) 2020-I-09** impose de notifier à l'ACPR toute externalisation d'activité « importante ou critique », au moins 6 semaines avant sa mise en œuvre, dans le cadre d'une politique d'externalisation écrite — obligation reprise des orientations européennes EBA/GL/2019/02.

### La question de la notification

Compte tenu du rôle de GitLab dans la chaîne CI/CD bancaire, la question de savoir si son usage constitue une « externalisation d'activité importante ou critique » au sens de l'instruction 2020-I-09 se pose légitimement — indépendamment de la clarification apportée plus haut sur l'hébergement en cloud privé interne, qui réduit le risque côté DORA sans nécessairement répondre à la question côté doctrine française, dont le périmètre (« activité », pas seulement « hébergement ») peut être plus large.

**À ce jour, aucune notification ACPR ni politique d'externalisation écrite couvrant GitLab n'est connue côté équipe technique.** Il ne faut pas en conclure une absence de conformité : cette démarche, si elle est nécessaire, relève probablement d'une fonction conformité ou gouvernance distincte de celle qui produit cette documentation technique, et qui peut très bien l'avoir déjà traitée sans que l'information soit remontée jusqu'ici. **Ce point doit être vérifié explicitement auprès de la fonction conformité de l'établissement** — ni validé, ni invalidé par ce corpus.

### Ce qui est déjà couvert

Le miroir USS constitue, sans que cela soit formulé en ces termes dans le reste du corpus, un argument concret de **maîtrise du risque de dépendance et de réversibilité** vis-à-vis de GitLab — l'un des points de vigilance classiques de l'ACPR sur l'externalisation. Cet argument mériterait d'être repris explicitement dans un éventuel dossier de conformité.

**Niveau de risque** : 🟡 **Bonne pratique recommandée / point à vérifier en urgence** — pas un manquement de l'architecture technique elle-même, mais une vérification procédurale qui ne peut pas être validée depuis ce seul corpus.

## Niveau international et sectoriel {: #niveau-international-sectoriel }

- **ISO/IEC 27001:2022, Annexe A, contrôle 8.32 « Change management »** : contrôle préventif exigeant que les changements soient planifiés, évalués en risque, autorisés, testés, documentés et communiqués, avec préservation d'une piste d'audit. La version 2013 de la norme contenait une mention plus explicite de contrôle de version du code, généralisée depuis dans la version 2022 — la norme n'a donc jamais imposé littéralement une « bijection », mais portait autrefois une exigence de traçabilité du code plus explicite qu'aujourd'hui.
- **[BCBS](glossaire.md#bcbs) 561 — « Principles for Operational Resilience »** (Comité de Bâle, mars 2021) : 7 catégories de principes — gouvernance, gestion du risque opérationnel, plans de continuité et tests, **cartographie des interconnexions et interdépendances des opérations critiques**, gestion de la dépendance aux tiers, gestion des incidents, résilience des systèmes TIC.

Le mécanisme de synchronisation (webhook, heartbeat, réconciliation) et le journal d'audit répondent largement, de façon implicite, au contrôle ISO 8.32. Le point le moins couvert est le principe BCBS de **cartographie formelle des interdépendances** : le corpus documente bien la dépendance technique à GitLab, mais ne produit nulle part une cartographie reliant une opération métier critique à la chaîne complète de ses dépendances techniques (GitLab → webhook → zCX → DB2/DRS → USS/zFS → réseau inter-datacenters) et aux vulnérabilités de chaque maillon.

**Niveau de risque** : 🟡 **Bonne pratique recommandée** — ni ISO 27001 ni BCBS ne sont des obligations légales directes pour un établissement français (BCBS est repris via les textes CRD/CRR et les textes ACPR/EBA déjà cités) ; leur absence n'est pas un blocage en soi, mais la lacune de cartographie est un point qu'un contrôle ACPR pourrait légitimement soulever.

## Bijection source/load — quelle base réglementaire ? {: #bijection-source-load-base-reglementaire }

La [bijection source/load exigée par l'Inspection Générale (IG)](glossaire.md#ig-inspection-generale), déjà mentionnée dans [Openz Uss Mirror](index.md) et détaillée dans [Prise d'image du patrimoine en production](perspectives.md#prise-dimage-du-patrimoine-en-production), mérite d'être clairement située du point de vue réglementaire.

**Aucun texte réglementaire, français ou européen, n'emploie ou n'impose littéralement une « bijection source/binaire ».** Ni DORA, ni l'arrêté du 3 novembre 2014, ni les orientations EBA/GL/2019/04, ni ISO/IEC 27001, ne contiennent cette formulation ou un équivalent aussi strict. Ce qu'ils exigent, de façon convergente, c'est une **traçabilité complète du cycle de changement** — enregistré, testé, évalué, approuvé, mis en œuvre, vérifié (DORA art. 9 ; formulation quasi identique dans l'arrêté de 2014) — sans jamais exiger une preuve déterministe de correspondance 1:1 entre un binaire donné et son source.

**La bijection source/load est donc une déclinaison interne, plus stricte que ce qu'exige la lettre des textes externes**, du principe général de traçabilité des changements porté par l'article 9 de DORA et l'arrêté de 2014. Ce n'est ni une invention arbitraire, ni la citation directe d'un texte externe — c'est la formulation la plus juste possible, et il n'y a pas lieu de la présenter comme découlant directement de DORA ou de l'arrêté 2014, ce qui serait inexact.

### Le mécanisme de tatouage constitue-t-il une preuve suffisante ?

Au regard de ce que les textes exigent réellement (traçabilité, contrôle, vérifiabilité — pas une bijection au sens mathématique strict), le mécanisme de tatouage décrit dans [Prise d'image du patrimoine en production](perspectives.md#prise-dimage-du-patrimoine-en-production) (identifiant de package inscrit dans l'[IDR](glossaire.md#idr-identification-record) au moment du link-edit, lien package↔commit↔load conservé dans DB2) est **substantiellement suffisant, et même plus rigoureux que le minimum exigé** : il permet une vérification a posteriori indépendante du load module lui-même, sans dépendre de la disponibilité du système source.

Une réserve subsiste, déjà identifiée sous l'angle technique dans [Points non couverts](points-ouverts.md) : la robustesse de cette preuve dépend entièrement de l'intégrité du registre DB2 qui relie package, commit et load — un auditeur rigoureux demandera vraisemblablement une preuve de l'intégrité et de la disponibilité de ce registre lui-même, ce qui rejoint les lacunes de fiabilité déjà notées pour DB2/DRS.

**Niveau de risque** : 🟢 **Risque faible** sur le mécanisme de tatouage lui-même ; 🟡 **bonne pratique recommandée** de documenter explicitement son origine interne (IG), plutôt que de laisser planer une ambiguïté sur la base légale précise invoquée.

## Synthèse des priorités {: #synthese-des-priorites }

| Niveau | Bloquant | Fortement recommandé | Risque faible |
|---|---|---|---|
| DORA | RTO/RPO non engagés (art. 12) | Vérifier le statut exact de GitLab (licence/support vs accord TIC), citer l'art. 9 pour le tatouage | — |
| ACPR | — | Vérification à mener auprès de la fonction conformité sur la notification 2020-I-09 | — |
| ISO/BCBS | — | Cartographie formelle des interdépendances (principe BCBS n° 4) | Certification ISO 27001 elle-même |
| Bijection source/load | — | Documenter l'origine interne (IG), pas un texte externe | Le mécanisme de tatouage lui-même |

## Sources

- [Règlement (UE) 2022/2554 (DORA) — texte consolidé, EUR-Lex](https://eur-lex.europa.eu/eli/reg/2022/2554/oj/eng)
- Règlement (UE) 2022/2554, articles 5-6, 9, 11-12, 17-18, 24-26, 28, 30-31
- Liste des prestataires TIC critiques désignés au titre de l'article 31 DORA, publiée par les autorités européennes de supervision le 18 novembre 2025
- Arrêté du 3 novembre 2014 relatif au contrôle interne des entreprises du secteur de la banque, des services de paiement et des services d'investissement, modifié par l'arrêté du 25 février 2021 — Légifrance
- Instruction ACPR 2020-I-09 relative à la notification des externalisations d'activités importantes ou critiques
- Orientations EBA/GL/2019/02 sur l'externalisation
- ISO/IEC 27001:2022, Annexe A, contrôle 8.32 « Change management »
- Comité de Bâle sur le contrôle bancaire (BCBS), *Principles for Operational Resilience*, mars 2021 (BCBS 561)
