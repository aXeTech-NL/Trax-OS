import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
POSTGRES = ROOT / "apps/api/postgres"
UPGRADE = POSTGRES / "upgrade-development-roles.sh"
INIT = POSTGRES / "00-runtime-role.sh"


def executable(path: Path, content: str) -> None:
    path.write_text(content)
    path.chmod(0o755)


def test_upgrade_requires_caller_supplied_legacy_credentials() -> None:
    result = subprocess.run(
        [str(UPGRADE)],
        cwd=ROOT,
        env={"PATH": os.environ["PATH"]},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert "TRAX_LEGACY_ADMIN_USER is required" in result.stderr


def test_upgrade_sends_legacy_credentials_only_over_stdin(tmp_path: Path) -> None:
    args = tmp_path / "args"
    supplied = tmp_path / "stdin"
    inherited = tmp_path / "inherited"
    executable(
        tmp_path / "docker",
        "#!/bin/sh\n"
        f"printf '%s\\n' \"$@\" > {args}\n"
        f"cat > {supplied}\n"
        f"printf '%s:%s' \"${{TRAX_LEGACY_ADMIN_USER-unset}}\" "
        f'"${{TRAX_LEGACY_ADMIN_PASSWORD-unset}}" > {inherited}\n',
    )
    legacy_user = "legacy-admin"
    legacy_password = "caller supplied secret"
    environment = os.environ | {
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "TRAX_LEGACY_ADMIN_USER": legacy_user,
        "TRAX_LEGACY_ADMIN_PASSWORD": legacy_password,
        "COMPOSE_ENV_FILE": ".env.example",
    }
    subprocess.run([str(UPGRADE)], cwd=ROOT, env=environment, check=True)

    arguments = args.read_text()
    assert legacy_user not in arguments
    assert legacy_password not in arguments
    assert "TRAX_ROLE_UPGRADE_IN_CONTAINER=1" in arguments
    assert "/opt/trax/upgrade-development-roles.sh" in arguments
    assert supplied.read_text() == f"{legacy_user}\n{legacy_password}\n"
    assert inherited.read_text() == "unset:unset"


def test_in_container_upgrade_uses_bound_psql_variables_and_bounded_roles(
    tmp_path: Path,
) -> None:
    args = tmp_path / "args"
    sql = tmp_path / "sql"
    password = tmp_path / "password"
    executable(
        tmp_path / "psql",
        "#!/bin/sh\n"
        f"printf '%s\\n' \"$@\" > {args}\n"
        f"printf '%s' \"$PGPASSWORD\" > {password}\n"
        f"cat > {sql}\n",
    )
    environment = os.environ | {
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "TRAX_ROLE_UPGRADE_IN_CONTAINER": "1",
        "POSTGRES_DB": "trax",
        "POSTGRES_USER": "trax_admin",
        "POSTGRES_PASSWORD": "new admin secret",
        "TRAX_RUNTIME_DB_USER": "trax_app",
        "TRAX_RUNTIME_DB_PASSWORD": "new runtime secret",
    }
    subprocess.run(
        [str(UPGRADE)],
        cwd=ROOT,
        env=environment,
        input="legacy_admin\nlegacy secret\n",
        text=True,
        check=True,
    )

    arguments = args.read_text()
    statement = sql.read_text()
    assert "legacy secret" not in arguments
    assert "new admin secret" not in arguments
    assert "new runtime secret" not in arguments
    assert password.read_text() == "legacy secret"
    assert "--set=legacy_admin_user=legacy_admin" in arguments
    assert "--set=admin_user=trax_admin" in arguments
    assert "--set=admin_password_file=" in arguments
    assert "--set=runtime_user=trax_app" in arguments
    assert "--set=runtime_password_file=" in arguments
    assert "BEGIN;" in statement and "COMMIT;" in statement
    assert "NOINHERIT NOREPLICATION NOBYPASSRLS" in statement
    assert "pg_read_file(:'admin_password_file')" in statement
    assert "pg_read_file(:'runtime_password_file')" in statement
    assert "membership.member, membership.roleid" in statement
    assert "REVOKE" not in statement


def test_clean_volume_initializer_has_the_same_fail_closed_role_policy(
    tmp_path: Path,
) -> None:
    sql = tmp_path / "sql"
    executable(tmp_path / "psql", f"#!/bin/sh\ncat > {sql}\n")
    environment = os.environ | {
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "POSTGRES_DB": "trax",
        "POSTGRES_USER": "trax_admin",
        "TRAX_RUNTIME_DB_USER": "trax_app",
        "TRAX_RUNTIME_DB_PASSWORD": "runtime secret",
    }
    subprocess.run([str(INIT)], cwd=ROOT, env=environment, check=True)
    statement = sql.read_text()
    assert "NOINHERIT NOREPLICATION NOBYPASSRLS" in statement
    assert "pg_read_file(:'runtime_password_file')" in statement
    assert "membership.member, membership.roleid" in statement
    assert "\\quit 3" in statement
    assert "REVOKE" not in statement
