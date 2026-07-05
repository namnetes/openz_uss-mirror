# Architecture

Cette section décrit les composants techniques prévus pour assurer la
résilience de la chaîne CI/CD (*Continuous Integration / Continuous
Delivery*) du Mainframe — c'est-à-dire sa capacité à continuer de fonctionner
même en cas de panne d'un outil externe comme GitLab.

<div class="grid cards" markdown>

-   :material-sync: **[Résilience et synchronisation USS](resilience/index.md)**

    Comment les sources GitLab sont maintenues à l'identique sur le miroir
    USS (*Unix System Services*) — synchronisation, mode dégradé et
    supervision.

-   :material-lifebuoy: **[Gestion des incidents et reprise](gestion-incidents.md)**

    Le [runbook](../glossaire.md) : que se passe-t-il pendant une panne,
    comment vérifier que USS est à jour ([état ISO](../glossaire.md)),
    comment resynchroniser après incident.

</div>
