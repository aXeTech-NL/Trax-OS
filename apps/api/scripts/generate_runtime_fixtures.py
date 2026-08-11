"""Generate privacy-neutral runtime fixtures from the real FastAPI routes."""

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from trax_api.main import create_app


def main(output: Path) -> None:
    with TestClient(create_app()) as client:
        contract = client.get("/api/contract")
        version = client.get("/api/v1/version")
        capabilities = client.get("/api/v1/capabilities")

    contract.raise_for_status()
    version.raise_for_status()
    capabilities.raise_for_status()
    document = {
        "capabilities": capabilities.json(),
        "contract": contract.json(),
        "version": version.json(),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        f"{json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False)}\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: generate_runtime_fixtures.py OUTPUT")
    main(Path(sys.argv[1]))
