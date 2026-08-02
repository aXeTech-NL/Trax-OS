FROM ghcr.io/astral-sh/uv:0.12.0@sha256:606e70c71c852d03f611b1e56a195d08648507018a7057fab82c4974c4eae105 AS uv

FROM python:3.12.12-slim-bookworm@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1

COPY --from=uv /uv /uvx /bin/

RUN groupadd --gid 10001 trax \
    && useradd --uid 10001 --gid trax --no-create-home --shell /usr/sbin/nologin trax

WORKDIR /app

COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY apps/api/src ./src
COPY apps/api/migrations ./migrations
COPY apps/api/alembic.ini ./alembic.ini
COPY scripts/compose_smoke.py ./scripts/compose_smoke.py
RUN uv sync --locked --no-dev --no-editable

USER 10001:10001
EXPOSE 18000

CMD ["uvicorn", "trax_api.main:app", "--host", "0.0.0.0", "--port", "18000", "--no-access-log"]
