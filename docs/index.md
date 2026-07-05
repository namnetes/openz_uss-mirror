# Openz Uss Mirror

!!! info "Projet de résilience CI/CD Mainframe"
    Ce projet s'inscrit dans un programme de modernisation de la chaîne CI/CD
    (*Continuous Integration / Continuous Delivery*) pour l'environnement IBM
    [Mainframe](glossaire.md#mainframe).

## Contexte et objectifs

### La transition technologique

L'intégration et le déploiement continus reposaient initialement sur la
solution propriétaire **ChangeMan**. L'objectif est de développer notre
propre alternative en s'appuyant sur des technologies modernes et standards
du marché — notamment **Git** et **GitLab**.

### L'enjeu stratégique de la résilience

L'environnement bancaire exige une disponibilité maximale. L'indisponibilité
d'une infrastructure externe au périmètre z/OS (GitLab, serveurs distribués
hors Mainframe) ne doit en aucun cas paralyser l'activité de développement ou
de production sur le Mainframe.

### Première étape clé

Pour garantir cette continuité d'activité, la priorité absolue est d'assurer
une **synchronisation permanente et locale des sources** : tout code présent
sur GitLab doit être disponible et à jour à tout instant directement sur le
Mainframe. Cela permet de basculer en mode dégradé si les outils
externes deviennent inaccessibles.

## Explorer la documentation

<div class="grid cards" markdown>

-   :material-sitemap: **[Architecture](architecture/index.md)**

    Les composants techniques prévus pour la résilience de la chaîne
    CI/CD — le miroir USS (*Unix System Services*), sa synchronisation, mode
    dégradé, supervision.

-   :material-telescope: **[Perspectives et synergies](perspectives.md)**

    Comment ce miroir USS pourrait servir d'autres projets — optimisation
    des builds, sauvegarde, prise d'image du patrimoine en production pour
    la bijection source/load exigée par l'Inspection Générale,
    cartographie applicative.

-   :material-book-alphabet: **[Glossaire](glossaire.md)**

    Les termes techniques de cette documentation, vulgarisés pour un
    public non averti.

-   :material-progress-question: **[Points non couverts](points-ouverts.md)**

    Les questions d'architecture identifiées mais pas encore tranchées.

</div>

## Démarrage rapide

```bash
make docs        # serveur local (port libre entre 8000 et 8050)
make docs-start  # serveur en arrière-plan
make docs-stop   # arrêter le serveur
make docs-build  # générer le site statique dans site/
```
