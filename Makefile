.PHONY: bootstrap generate contract-check architecture-check api-check web-check test check dev compose-config db-up db-migrate db-check db-down

bootstrap:
	npm ci
	uv sync --project apps/api --locked

generate:
	npm run generate

contract-check:
	npm run contract:check

architecture-check:
	npm run architecture:check

api-check:
	uv run --project apps/api ruff format --check apps/api
	uv run --project apps/api ruff check apps/api
	uv run --project apps/api mypy apps/api/src apps/api/tests

web-check:
	npm run check --workspace @trax-os/web

test:
	uv run --project apps/api pytest apps/api/tests
	npm run test --workspace @trax-os/web

check: contract-check architecture-check api-check web-check test

dev:
	npm run dev

compose-config:
	docker compose --env-file .env.example config --quiet

db-up:
	docker compose --env-file .env.example up -d --wait database

db-migrate:
	uv run --project apps/api alembic -c apps/api/alembic.ini upgrade head

db-check:
	uv run --project apps/api alembic -c apps/api/alembic.ini check

db-down:
	docker compose --env-file .env.example down
