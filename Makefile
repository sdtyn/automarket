# Convenience targets for local docker-compose integration testing
# (EPIC23-T4). See docs/dev-notes.md §5 for the full first-run sequence —
# `make up` alone starts an empty database; `make db-init` deploys the
# schema into it, and only needs to run once per fresh volume.

.PHONY: up down db-init logs

up:
	docker compose up -d --build

down:
	docker compose down

# One-time (or after a fresh `docker compose down -v`): creates the
# cds_model schema-evolution baseline, then deploys the full initial
# schema. @cap-js/postgres's own schema-evolution mechanism, not a
# hand-written migration file — see docs/dev-notes.md §3.
db-init:
	docker compose exec app npx cds deploy --model-only
	docker compose exec app npx cds deploy

logs:
	docker compose logs -f app
