# Architecture

Cette section décrit les composants techniques prévus pour assurer la
résilience de la chaîne CI/CD (*Continuous Integration / Continuous
Delivery*) Mainframe — c'est-à-dire sa capacité à continuer de fonctionner
même en cas de panne d'un outil externe comme GitLab.

<div class="grid cards" markdown>

-   :material-sync: **[Résilience et synchronisation USS](resilience/index.md)**

    Comment les sources GitLab sont maintenues à l'identique sur
    USS (*Unix System Services*) pour garantir un mode dégradé en cas de
    panne.

-   :material-lifebuoy: **[Gestion des incidents et reprise](gestion-incidents.md)**

    Le runbook : que se passe-t-il pendant une panne, comment vérifier que
    USS est à jour (état ISO), comment resynchroniser après incident.

</div>
