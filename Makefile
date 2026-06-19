.DEFAULT_GOAL := help

# ── Documentation (mkdocsinit) ────────────────────────────────────────────────
.PHONY: docs docs-start docs-stop docs-build

PID_FILE := .mkdocs.pid
LOG_FILE := .mkdocs.log
HOST     := 127.0.0.1
PORT     := $(shell \
	for p in $$(seq 8000 8050); do \
		lsof -ti:$$p >/dev/null 2>&1 || { echo $$p; break; }; \
	done)

export DISABLE_MKDOCS_2_WARNING := true

docs:
	uv run mkdocs serve --dev-addr $(HOST):$(PORT)

docs-start:
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
		echo "MkDocs déjà démarré (PID $$(cat $(PID_FILE)))"; \
	else \
		uv run mkdocs serve --dev-addr $(HOST):$(PORT) \
			> $(LOG_FILE) 2>&1 & \
		echo $$! > $(PID_FILE); \
		echo "MkDocs démarré (PID $$(cat $(PID_FILE))) — http://$(HOST):$(PORT)"; \
	fi

docs-stop:
	@if [ -f $(PID_FILE) ]; then \
		PID=$$(cat $(PID_FILE)); \
		if kill -0 $$PID 2>/dev/null; then \
			kill $$PID && echo "MkDocs arrêté (PID $$PID)"; \
		else \
			echo "Processus $$PID introuvable (déjà arrêté ?)"; \
		fi; \
		rm -f $(PID_FILE); \
	else \
		echo "Aucun PID enregistré — MkDocs ne tourne pas en background"; \
	fi

docs-build:
	uv run mkdocs build
	@echo "Site généré dans site/"

help:
	@printf '\033[1mDocumentation :\033[0m\n'
	@printf '  \033[36m%-14s\033[0m %s\n' docs       'Serveur local (port libre 8000-8050)'
	@printf '  \033[36m%-14s\033[0m %s\n' docs-start 'Serveur en arrière-plan'
	@printf '  \033[36m%-14s\033[0m %s\n' docs-stop  'Arrêter le serveur'
	@printf '  \033[36m%-14s\033[0m %s\n' docs-build 'Générer le site statique'
