"""Alembic migration environment."""

from asyncio import run
from logging.config import fileConfig
from os import getenv

from alembic import context
from sqlalchemy.ext.asyncio import async_engine_from_config

from trax_api.schema import metadata

config = context.config
if config.config_file_name:
    # Alembic can run in-process in the migration lifecycle test. Preserve
    # application/test loggers rather than disabling every logger created
    # before this module is loaded.
    fileConfig(config.config_file_name, disable_existing_loggers=False)
config.set_main_option(
    "sqlalchemy.url",
    getenv(
        "TRAX_MIGRATION_DATABASE_URL",
        getenv("TRAX_DATABASE_URL", config.get_main_option("sqlalchemy.url")),
    ),
)


def run_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def include_object(
    _object: object,
    _name: str | None,
    _type: str,
    reflected: bool,
    compare_to: object | None,
) -> bool:
    return not (reflected and compare_to is None)


def configure_and_run(connection: object) -> None:
    context.configure(
        connection=connection,
        target_metadata=metadata,
        compare_type=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_online() -> None:
    engine = async_engine_from_config(config.get_section(config.config_ini_section) or {})
    async with engine.connect() as connection:
        await connection.run_sync(configure_and_run)
    await engine.dispose()


if context.is_offline_mode():
    run_offline()
else:
    run(run_online())
