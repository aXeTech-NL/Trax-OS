"""Write the canonical FastAPI OpenAPI document deterministically."""

import json
import sys
from pathlib import Path

from trax_api.main import create_app


def main(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    document = json.dumps(create_app().openapi(), indent=2, sort_keys=True, ensure_ascii=False)
    output.write_text(f"{document}\n", encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: generate_openapi.py OUTPUT")
    main(Path(sys.argv[1]))
