.PHONY: bootstrap generate contract-check api-check web-check test check dev compose-config

bootstrap:
	npm ci
	uv sync --project apps/api --locked

generate:
	npm run generate

contract-check:
	npm run contract:check

api-check:
	uv run --project apps/api ruff format --check apps/api
	uv run --project apps/api ruff check apps/api
	uv run --project apps/api mypy apps/api/src apps/api/tests

web-check:
	npm run check --workspace @trax-os/web

test:
	uv run --project apps/api pytest apps/api/tests
	npm run test --workspace @trax-os/web

check: contract-check api-check web-check test

dev: bootstrap
	npm run dev

compose-config:
	docker compose --env-file .env.example config --quiet
