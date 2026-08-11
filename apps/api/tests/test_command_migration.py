import asyncio
import os
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine

ROOT = Path(__file__).resolve().parents[3]
ALEMBIC_INI = ROOT / "apps/api/alembic.ini"
ADMIN_DATABASE_URL = os.getenv(
    "TRAX_ADMIN_DATABASE_URL",
    "postgresql+asyncpg://trax_admin:trax-admin-development-only@127.0.0.1:5432/trax",
)
RUNTIME_DATABASE_URL = os.getenv(
    "TRAX_DATABASE_URL",
    "postgresql+asyncpg://trax_app:trax-application-development-only@127.0.0.1:5432/trax",
)


@contextmanager
def migration_url(url: str):
    previous = os.environ.get("TRAX_MIGRATION_DATABASE_URL")
    os.environ["TRAX_MIGRATION_DATABASE_URL"] = url
    try:
        config = Config(str(ALEMBIC_INI))
        config.set_main_option("script_location", str(ROOT / "apps/api/migrations"))
        yield config
    finally:
        if previous is None:
            os.environ.pop("TRAX_MIGRATION_DATABASE_URL", None)
        else:
            os.environ["TRAX_MIGRATION_DATABASE_URL"] = previous


async def create_database(name: str) -> None:
    server_url = make_url(ADMIN_DATABASE_URL).set(database="postgres")
    engine = create_async_engine(server_url, isolation_level="AUTOCOMMIT", hide_parameters=True)
    async with engine.connect() as connection:
        role = (
            (
                await connection.execute(
                    text(
                        "SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, "
                        "rolinherit, rolreplication FROM pg_roles WHERE rolname='trax_app'"
                    )
                )
            )
            .mappings()
            .one()
        )
        assert dict(role) == {
            "rolcanlogin": True,
            "rolsuper": False,
            "rolbypassrls": False,
            "rolcreatedb": False,
            "rolcreaterole": False,
            "rolinherit": False,
            "rolreplication": False,
        }
        memberships = (
            await connection.execute(
                text(
                    "SELECT count(*) FROM pg_auth_members membership "
                    "JOIN pg_roles runtime_role ON runtime_role.oid IN "
                    "(membership.member, membership.roleid) "
                    "WHERE runtime_role.rolname='trax_app'"
                )
            )
        ).scalar_one()
        assert memberships == 0
        await connection.execute(text(f'CREATE DATABASE "{name}"'))
    await engine.dispose()


async def drop_database(name: str) -> None:
    server_url = make_url(ADMIN_DATABASE_URL).set(database="postgres")
    engine = create_async_engine(server_url, isolation_level="AUTOCOMMIT", hide_parameters=True)
    async with engine.connect() as connection:
        await connection.execute(
            text(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname=:name AND pid<>pg_backend_pid()"
            ),
            {"name": name},
        )
        await connection.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
    await engine.dispose()


async def set_adversarial_runtime_membership(parent_role: str, *, present: bool) -> None:
    server_url = make_url(ADMIN_DATABASE_URL).set(database="postgres")
    engine = create_async_engine(server_url, isolation_level="AUTOCOMMIT", hide_parameters=True)
    async with engine.connect() as connection:
        if present:
            await connection.execute(text(f'CREATE ROLE "{parent_role}" NOLOGIN CREATEDB'))
            await connection.execute(text(f'GRANT "{parent_role}" TO trax_app'))
        else:
            await connection.execute(text(f'REVOKE "{parent_role}" FROM trax_app'))
            await connection.execute(text(f'DROP ROLE "{parent_role}"'))
    await engine.dispose()


async def seed_baseline(url: str) -> tuple[str, str, str]:
    user_id, workspace_id, journey_id = str(uuid4()), str(uuid4()), str(uuid4())
    now = datetime.now(UTC)
    engine = create_async_engine(url, hide_parameters=True)
    values = {
        "user_id": user_id,
        "workspace_id": workspace_id,
        "journey_id": journey_id,
        "email": f"migration-{user_id}@example.com",
        "now": now,
    }
    async with engine.begin() as connection:
        for statement in (
            "INSERT INTO users(id,email,display_name,created_at) "
            "VALUES (:user_id,:email,'Migration user',:now)",
            "INSERT INTO workspaces(id,type,name,created_at) "
            "VALUES (:workspace_id,'PERSONAL','Migration workspace',:now)",
            "INSERT INTO workspace_memberships(workspace_id,user_id,role,created_at) "
            "VALUES (:workspace_id,:user_id,'OWNER',:now)",
            "INSERT INTO journeys(id,workspace_id,name,status,record_version,"
            "created_at,updated_at) "
            "VALUES (:journey_id,:workspace_id,'Existing','planning',1,:now,:now)",
        ):
            await connection.execute(text(statement), values)
    await engine.dispose()
    return user_id, workspace_id, journey_id


async def assert_membership_rejection_was_transactional(admin_url: str) -> None:
    engine = create_async_engine(admin_url, hide_parameters=True)
    async with engine.connect() as connection:
        version = (
            await connection.execute(text("SELECT version_num FROM alembic_version"))
        ).scalar_one()
        assert version == "0001_server_backed_web"
        tables = set(await connection.run_sync(lambda sync: inspect(sync).get_table_names()))
        assert not {"command_change_sets", "command_change_events", "command_receipts"} & tables
        assert (
            await connection.execute(
                text("SELECT to_regprocedure('trax_lock_membership(uuid,uuid)')")
            )
        ).scalar_one_or_none() is None
    await engine.dispose()


async def assert_upgraded(admin_url: str, runtime_url: str, ids: tuple[str, str, str]) -> None:
    user_id, workspace_id, journey_id = ids
    engine = create_async_engine(admin_url, hide_parameters=True)
    async with engine.connect() as connection:
        table_names = set(await connection.run_sync(lambda sync: inspect(sync).get_table_names()))
        assert {"command_change_sets", "command_change_events", "command_receipts"} <= table_names
        constraints = (
            (
                await connection.execute(
                    text(
                        "SELECT conname, pg_get_constraintdef(oid) AS definition "
                        "FROM pg_constraint WHERE connamespace='public'::regnamespace "
                        "AND conrelid IN ('command_change_sets'::regclass,"
                        "'command_change_events'::regclass,'command_receipts'::regclass)"
                    )
                )
            )
            .mappings()
            .all()
        )
        by_name = {row["conname"]: row["definition"] for row in constraints}
        change_set_event_scope = by_name["command_change_set_scope_unique"]
        assert "id, workspace_id, actor_user_id, entity_type, entity_id" in change_set_event_scope
        event_fk = by_name["command_change_event_scope_fk"]
        assert "change_set_id, workspace_id, actor_user_id, entity_type, entity_id" in event_fk
        assert "id, workspace_id, actor_user_id, entity_type, entity_id" in event_fk
        receipt_scope = by_name["command_change_set_receipt_scope_unique"]
        assert "command_id, entity_type, entity_id" in receipt_scope
        receipt_fk = by_name["command_receipt_change_set_scope_fk"]
        assert (
            "FOREIGN KEY (change_set_id, workspace_id, actor_user_id, command_id, "
            "entity_type, entity_id)" in receipt_fk
        )
        assert (
            "REFERENCES command_change_sets(id, workspace_id, actor_user_id, command_id, "
            "entity_type, entity_id)" in receipt_fk
        )
        expected_checks = {
            "command_change_set_type_valid": "command_type = 'journey.update'",
            "command_change_set_version_valid": "command_version = 1",
            "command_change_set_entity_valid": "entity_type = 'journey'",
            "command_change_event_entity_valid": "entity_type = 'journey'",
            "command_change_event_action_valid": "action = 'updated'",
            "command_receipt_type_valid": "command_type = 'journey.update'",
            "command_receipt_version_valid": "command_version = 1",
            "command_receipt_digest_shape_valid": "request_digest ~ '^[0-9a-f]{64}$'",
            "command_receipt_entity_valid": "entity_type = 'journey'",
            "command_receipt_result_version_positive": "result_record_version >= 1",
        }
        for name, fragment in expected_checks.items():
            normalized = " ".join(
                by_name[name]
                .lower()
                .replace("::text", "")
                .replace("(", " ")
                .replace(")", " ")
                .split()
            )
            assert fragment in normalized
        indexes = {
            row[0]
            for row in (
                await connection.execute(
                    text(
                        "SELECT indexname FROM pg_indexes WHERE schemaname='public' "
                        "AND tablename IN ('command_change_sets','command_change_events')"
                    )
                )
            ).all()
        }
        assert {
            "ix_command_change_sets_workspace_created",
            "ix_command_change_events_workspace_created",
        } <= indexes
        rls = (
            (
                await connection.execute(
                    text(
                        "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
                        "WHERE relname IN ('journeys','journey_segments','packing_items',"
                        "'command_change_sets','command_change_events','command_receipts')"
                    )
                )
            )
            .mappings()
            .all()
        )
        assert len(rls) == 6 and all(
            row["relrowsecurity"] and row["relforcerowsecurity"] for row in rls
        )
        policies = (
            (
                await connection.execute(
                    text(
                        "SELECT tablename, policyname, qual, with_check FROM pg_policies "
                        "WHERE schemaname='public' AND tablename LIKE 'command_%'"
                    )
                )
            )
            .mappings()
            .all()
        )
        assert len(policies) == 3
        assert all("trax.workspace_id" in (row["qual"] or "") for row in policies)
        assert all("trax.user_id" in (row["with_check"] or "") for row in policies)
        grants = (
            await connection.execute(
                text(
                    "SELECT table_name, privilege_type FROM information_schema.role_table_grants "
                    "WHERE grantee='trax_app'"
                )
            )
        ).all()
        grant_map: dict[str, set[str]] = {}
        for table_name, privilege in grants:
            grant_map.setdefault(table_name, set()).add(privilege)
        assert grant_map["workspace_memberships"] == {"SELECT", "INSERT"}
        assert grant_map["journeys"] == {"SELECT", "INSERT", "UPDATE", "DELETE"}
        for table in ("command_change_sets", "command_change_events", "command_receipts"):
            assert grant_map[table] == {"SELECT", "INSERT"}
        schema_access = (
            (
                await connection.execute(
                    text(
                        "SELECT has_schema_privilege('trax_app','public','USAGE') AS usage, "
                        "has_schema_privilege('trax_app','public','CREATE') AS create"
                    )
                )
            )
            .mappings()
            .one()
        )
        assert dict(schema_access) == {"usage": True, "create": False}
        sequence_or_default_grants = (
            await connection.execute(
                text(
                    "SELECT "
                    "(SELECT count(*) FROM information_schema.role_usage_grants "
                    "WHERE grantee='trax_app' AND object_type='SEQUENCE') + "
                    "(SELECT count(*) FROM pg_default_acl default_acl "
                    "CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) acl "
                    "JOIN pg_roles role ON role.oid=acl.grantee "
                    "WHERE role.rolname='trax_app')"
                )
            )
        ).scalar_one()
        assert sequence_or_default_grants == 0
        function_access = (
            await connection.execute(
                text(
                    "SELECT has_function_privilege('trax_app', "
                    "'trax_lock_membership(uuid,uuid)', 'EXECUTE')"
                )
            )
        ).scalar_one()
        assert function_access is True
        function_security = (
            (
                await connection.execute(
                    text(
                        "SELECT owner.rolname AS owner, function.prosecdef, function.proconfig, "
                        "count(*) FILTER (WHERE acl.grantee=0) AS public_grants "
                        "FROM pg_proc function JOIN pg_roles owner ON owner.oid=function.proowner "
                        "LEFT JOIN LATERAL aclexplode(function.proacl) acl ON true "
                        "WHERE function.oid='trax_lock_membership(uuid,uuid)'::regprocedure "
                        "GROUP BY owner.rolname,function.prosecdef,function.proconfig"
                    )
                )
            )
            .mappings()
            .one()
        )
        assert function_security["owner"] == "trax_admin"
        assert function_security["prosecdef"] is True
        assert function_security["proconfig"] == ["search_path=pg_catalog, public"]
        assert function_security["public_grants"] == 0
    await engine.dispose()

    runtime = create_async_engine(runtime_url, hide_parameters=True)
    async with runtime.connect() as connection:
        transaction = await connection.begin()
        await connection.execute(
            text(
                "SELECT set_config('trax.user_id',:user_id,true), "
                "set_config('trax.workspace_id',:workspace_id,true)"
            ),
            {"user_id": user_id, "workspace_id": workspace_id},
        )
        assert (
            await connection.execute(
                text("SELECT name FROM journeys WHERE id=:id"), {"id": journey_id}
            )
        ).scalar_one() == "Existing"
        assert (
            await connection.execute(
                text("SELECT trax_lock_membership(:workspace_id,:user_id)"),
                {"workspace_id": workspace_id, "user_id": user_id},
            )
        ).scalar_one() == "OWNER"
        assert (
            await connection.execute(
                text("SELECT trax_lock_membership(:workspace_id,:user_id)"),
                {"workspace_id": str(uuid4()), "user_id": user_id},
            )
        ).scalar_one_or_none() is None
        assert (
            await connection.execute(
                text("SELECT trax_lock_membership(:workspace_id,:user_id)"),
                {"workspace_id": workspace_id, "user_id": str(uuid4())},
            )
        ).scalar_one_or_none() is None
        await transaction.rollback()
    async with runtime.connect() as connection:
        assert (await connection.execute(text("SELECT count(*) FROM journeys"))).scalar_one() == 0
        assert (
            await connection.execute(
                text("SELECT trax_lock_membership(:workspace_id,:user_id)"),
                {"workspace_id": workspace_id, "user_id": user_id},
            )
        ).scalar_one_or_none() is None
    await runtime.dispose()


async def assert_entity_identity_foreign_keys(admin_url: str, ids: tuple[str, str, str]) -> None:
    user_id, workspace_id, journey_id = ids
    engine = create_async_engine(admin_url, hide_parameters=True)
    now = datetime.now(UTC)

    async with engine.connect() as connection:
        transaction = await connection.begin()
        change_set_id, command_id = str(uuid4()), str(uuid4())
        await connection.execute(
            text(
                "INSERT INTO command_change_sets("
                "id,workspace_id,actor_user_id,command_id,command_type,command_version,"
                "origin,reversibility,entity_type,entity_id,created_at) VALUES ("
                ":change_set_id,:workspace_id,:user_id,:command_id,'journey.update',1,"
                "'web','full','journey',:journey_id,:now)"
            ),
            {
                "change_set_id": change_set_id,
                "workspace_id": workspace_id,
                "user_id": user_id,
                "command_id": command_id,
                "journey_id": journey_id,
                "now": now,
            },
        )
        with pytest.raises(DBAPIError):
            await connection.execute(
                text(
                    "INSERT INTO command_change_events("
                    "id,change_set_id,workspace_id,actor_user_id,sequence,entity_type,"
                    "entity_id,action,before_state,after_state,created_at) VALUES ("
                    ":id,:change_set_id,:workspace_id,:user_id,1,'journey',:wrong_entity_id,"
                    "'updated','{}'::jsonb,'{}'::jsonb,:now)"
                ),
                {
                    "id": str(uuid4()),
                    "change_set_id": change_set_id,
                    "workspace_id": workspace_id,
                    "user_id": user_id,
                    "wrong_entity_id": str(uuid4()),
                    "now": now,
                },
            )
        await transaction.rollback()

    async with engine.connect() as connection:
        transaction = await connection.begin()
        change_set_id, command_id = str(uuid4()), str(uuid4())
        await connection.execute(
            text(
                "INSERT INTO command_change_sets("
                "id,workspace_id,actor_user_id,command_id,command_type,command_version,"
                "origin,reversibility,entity_type,entity_id,created_at) VALUES ("
                ":change_set_id,:workspace_id,:user_id,:command_id,'journey.update',1,"
                "'web','full','journey',:journey_id,:now)"
            ),
            {
                "change_set_id": change_set_id,
                "workspace_id": workspace_id,
                "user_id": user_id,
                "command_id": command_id,
                "journey_id": journey_id,
                "now": now,
            },
        )
        with pytest.raises(DBAPIError):
            await connection.execute(
                text(
                    "INSERT INTO command_receipts("
                    "workspace_id,actor_user_id,command_id,command_type,command_version,"
                    "digest_version,request_digest,outcome,entity_type,entity_id,"
                    "result_record_version,change_set_id,created_at) VALUES ("
                    ":workspace_id,:user_id,:command_id,'journey.update',1,1,:digest,"
                    "'applied','journey',:wrong_entity_id,2,:change_set_id,:now)"
                ),
                {
                    "workspace_id": workspace_id,
                    "user_id": user_id,
                    "command_id": command_id,
                    "digest": "0" * 64,
                    "wrong_entity_id": str(uuid4()),
                    "change_set_id": change_set_id,
                    "now": now,
                },
            )
        await transaction.rollback()

    await engine.dispose()


async def assert_downgraded(admin_url: str, runtime_url: str, journey_id: str) -> None:
    engine = create_async_engine(admin_url, hide_parameters=True)
    async with engine.connect() as connection:
        tables = set(await connection.run_sync(lambda sync: inspect(sync).get_table_names()))
        assert not {"command_change_sets", "command_change_events", "command_receipts"} & tables
        assert (
            await connection.execute(
                text("SELECT to_regprocedure('trax_lock_membership(uuid,uuid)')")
            )
        ).scalar_one_or_none() is None
        assert (
            await connection.execute(
                text("SELECT name FROM journeys WHERE id=:id"), {"id": journey_id}
            )
        ).scalar_one() == "Existing"
        policy = (
            await connection.execute(
                text(
                    "SELECT qual FROM pg_policies WHERE schemaname='public' "
                    "AND tablename='journeys' AND policyname='journey_workspace_policy'"
                )
            )
        ).scalar_one()
        assert "trax.user_id" in policy and "trax.workspace_id" not in policy
        direct_table_grants = (
            await connection.execute(
                text(
                    "SELECT count(*) FROM information_schema.role_table_grants "
                    "WHERE grantee='trax_app' AND table_schema='public'"
                )
            )
        ).scalar_one()
        assert direct_table_grants == 0
        direct_schema_grants = (
            await connection.execute(
                text(
                    "SELECT count(*) FROM aclexplode((SELECT nspacl FROM pg_namespace "
                    "WHERE nspname='public')) acl JOIN pg_roles role ON role.oid=acl.grantee "
                    "WHERE role.rolname='trax_app'"
                )
            )
        ).scalar_one()
        assert direct_schema_grants == 0
    await engine.dispose()

    runtime = create_async_engine(runtime_url, hide_parameters=True)
    async with runtime.connect() as connection:
        with pytest.raises(DBAPIError):
            await connection.execute(text("SELECT count(*) FROM journeys"))
    await runtime.dispose()


def test_real_postgresql_upgrade_downgrade_rls_grants_and_schema_check() -> None:
    database_name = f"trax_command_migration_{uuid4().hex}"
    admin_url = (
        make_url(ADMIN_DATABASE_URL)
        .set(database=database_name)
        .render_as_string(hide_password=False)
    )
    runtime_url = (
        make_url(RUNTIME_DATABASE_URL)
        .set(database=database_name)
        .render_as_string(hide_password=False)
    )
    parent_role = f"trax_migration_parent_{uuid4().hex}"
    membership_present = False
    asyncio.run(create_database(database_name))
    try:
        with migration_url(admin_url) as config:
            command.upgrade(config, "0001_server_backed_web")
        ids = asyncio.run(seed_baseline(admin_url))
        asyncio.run(set_adversarial_runtime_membership(parent_role, present=True))
        membership_present = True
        with (
            migration_url(admin_url) as config,
            pytest.raises(DBAPIError, match="must not inherit any role membership"),
        ):
            command.upgrade(config, "head")
        asyncio.run(assert_membership_rejection_was_transactional(admin_url))
        asyncio.run(set_adversarial_runtime_membership(parent_role, present=False))
        membership_present = False
        with migration_url(admin_url) as config:
            command.upgrade(config, "head")
        asyncio.run(assert_upgraded(admin_url, runtime_url, ids))
        asyncio.run(assert_entity_identity_foreign_keys(admin_url, ids))
        with migration_url(admin_url) as config:
            command.downgrade(config, "0001_server_backed_web")
        asyncio.run(assert_downgraded(admin_url, runtime_url, ids[2]))
        with migration_url(admin_url) as config:
            command.upgrade(config, "head")
            command.check(config)
    finally:
        if membership_present:
            asyncio.run(set_adversarial_runtime_membership(parent_role, present=False))
        asyncio.run(drop_database(database_name))
