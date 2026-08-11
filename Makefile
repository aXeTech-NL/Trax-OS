COMPOSE_ENV_FILE ?= $(if $(wildcard .env),.env,.env.example)
COMPOSE = docker compose --env-file "$(COMPOSE_ENV_FILE)"
UV_RUN = uv run --env-file "$(COMPOSE_ENV_FILE)" --project apps/api

.PHONY: bootstrap generate contract-check contract-compat architecture-check boundaries-check threat-model-check api-check web-check test check dev compose-config compose-build compose-up compose-smoke compose-ps compose-logs compose-down compose-clean db-up db-upgrade-development-roles db-migrate db-check db-down

bootstrap:
	npm ci
	uv sync --project apps/api --locked

generate:
	npm run generate

contract-check:
	npm run contract:check

contract-compat:
	@test -n "$(BASE_CONTRACT)" || (echo "BASE_CONTRACT is required" >&2; exit 2)
	npm run contract:compat -- "$(BASE_CONTRACT)" packages/api-contract/generated/openapi.json

architecture-check:
	npm run architecture:check

boundaries-check:
	npm run boundaries:check

threat-model-check:
	npm run security:check

api-check:
	$(UV_RUN) ruff format --check apps/api scripts/compose_smoke.py scripts/python-imports.py
	$(UV_RUN) ruff check apps/api scripts/compose_smoke.py scripts/python-imports.py
	$(UV_RUN) mypy apps/api/src apps/api/tests scripts/compose_smoke.py scripts/python-imports.py

web-check:
	npm run check --workspace @trax-os/web

test:
	$(UV_RUN) pytest apps/api/tests
	npm run test --workspace @trax-os/web

check: contract-check architecture-check boundaries-check threat-model-check api-check web-check test

dev:
	$(UV_RUN) npm run dev

compose-config:
	$(COMPOSE) config --quiet

compose-build:
	$(COMPOSE) --profile acceptance build migration api web smoke

compose-up:
	$(COMPOSE) up --build --detach --wait database migration api web

compose-smoke:
	$(COMPOSE) run --build --rm --no-deps smoke

compose-ps:
	$(COMPOSE) ps -a

compose-logs:
	$(COMPOSE) logs --no-color --tail=200 migration api web

compose-down:
	$(COMPOSE) down --remove-orphans

compose-clean:
	@test "$(CONFIRM_COMPOSE_CLEAN)" = "1" || { \
		echo "Refusing to delete PostgreSQL data. Re-run with CONFIRM_COMPOSE_CLEAN=1." >&2; \
		exit 2; \
	}
	$(COMPOSE) --profile acceptance down --volumes --remove-orphans

db-up:
	$(COMPOSE) up -d --wait database

db-upgrade-development-roles:
	@COMPOSE_ENV_FILE="$(COMPOSE_ENV_FILE)" apps/api/postgres/upgrade-development-roles.sh

db-migrate:
	$(UV_RUN) alembic -c apps/api/alembic.ini upgrade head

db-check:
	$(UV_RUN) alembic -c apps/api/alembic.ini check

db-down:
	$(COMPOSE) down
