"""MkDocs macros — variables, filtres et macros Jinja2 personnalisés.

Référence : https://mkdocs-macros-plugin.readthedocs.io/
"""

from __future__ import annotations

from mkdocs_macros.plugin import MacrosPlugin


def define_env(env: MacrosPlugin) -> None:
    """Déclare variables, filtres et macros disponibles dans les pages Markdown.

    Example:
        # Ajouter une variable
        env.variables["version"] = "1.0.0"

        # Ajouter un filtre
        @env.filter
        def upper(s: str) -> str:
            return s.upper()

        # Ajouter une macro
        @env.macro
        def greet(name: str) -> str:
            return f"Bonjour, {name} !"
    """
