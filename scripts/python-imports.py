#!/usr/bin/env python3
"""Emit deterministic Python project/import facts for module-boundary checks."""

from __future__ import annotations

import argparse
import ast
import json
import os
import stat
import tomllib
from pathlib import Path
from typing import Any


def fail(message: str) -> None:
    raise SystemExit(message)


def assert_no_symlink_components(root: Path, target: Path, label: str) -> None:
    root_real = root.resolve(strict=True)
    try:
        relative = target.absolute().relative_to(root.absolute())
    except ValueError:
        fail(f"{label} escapes repository")
    current = root.absolute()
    for part in relative.parts:
        current /= part
        try:
            mode = os.lstat(current).st_mode
        except OSError as error:
            fail(f"{label} cannot be inspected: {error}")
        if stat.S_ISLNK(mode):
            fail(
                f"{label} contains symlink component {current.relative_to(root.absolute())}"
            )
    resolved = target.resolve(strict=True)
    try:
        resolved.relative_to(root_real)
    except ValueError:
        fail(f"{label} resolves outside repository")


def module_name(module_root: Path, filename: Path) -> str:
    relative = filename.relative_to(module_root)
    parts = list(relative.with_suffix("").parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def resolve_from(
    source: str, source_is_package: bool, node: ast.ImportFrom
) -> str | None:
    if node.level == 0:
        return node.module
    package = source.split(".")
    if not source_is_package and package:
        package = package[:-1]
    ascend = node.level - 1
    if ascend > len(package):
        return None
    base = package[: len(package) - ascend]
    if node.module:
        base.extend(node.module.split("."))
    return ".".join(base)


def imported_names(node: ast.Import | ast.ImportFrom) -> list[str]:
    return sorted(alias.name for alias in node.names)


def discover_python_files(root: Path, module_root: Path) -> list[Path]:
    files: list[Path] = []
    for current, directory_names, file_names in os.walk(module_root, followlinks=False):
        current_path = Path(current)
        kept: list[str] = []
        for name in sorted(directory_names):
            candidate = current_path / name
            mode = os.lstat(candidate).st_mode
            if stat.S_ISLNK(mode):
                fail(
                    f"Python source tree contains directory symlink {candidate.relative_to(root)}"
                )
            if not stat.S_ISDIR(mode):
                fail(
                    f"Python source tree entry is not a directory {candidate.relative_to(root)}"
                )
            kept.append(name)
        directory_names[:] = kept
        for name in sorted(file_names):
            candidate = current_path / name
            mode = os.lstat(candidate).st_mode
            if stat.S_ISLNK(mode):
                fail(
                    f"Python source tree contains file symlink {candidate.relative_to(root)}"
                )
            if name.endswith(".py"):
                if not stat.S_ISREG(mode):
                    fail(
                        f"Python source is not a regular file {candidate.relative_to(root)}"
                    )
                resolved = candidate.resolve(strict=True)
                try:
                    resolved.relative_to(module_root.resolve(strict=True))
                except ValueError:
                    fail(
                        f"Python source resolves outside module root: {candidate.relative_to(root)}"
                    )
                files.append(candidate)
    return sorted(files)


def dotted_binding(node: ast.AST, bindings: dict[str, str]) -> str | None:
    if isinstance(node, ast.Name):
        return bindings.get(node.id, node.id)
    if isinstance(node, ast.Attribute):
        base = dotted_binding(node.value, bindings)
        return f"{base}.{node.attr}" if base else None
    return None


DYNAMIC_LOADERS = {"importlib.import_module", "builtins.__import__"}


def destructuring_contains_loader(node: ast.AST, bindings: dict[str, str]) -> bool:
    return any(
        dotted_binding(child, bindings) in DYNAMIC_LOADERS for child in ast.walk(node)
    )


def collect_dynamic_bindings(tree: ast.AST) -> dict[str, str]:
    bindings: dict[str, str] = {
        "__import__": "builtins.__import__",
        "importlib": "importlib",
    }
    assignments: list[tuple[str, ast.AST]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                binding = alias.asname or alias.name.split(".")[0]
                bindings[binding] = (
                    alias.name if alias.asname else alias.name.split(".")[0]
                )
        elif isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                binding = alias.asname or alias.name
                bindings[binding] = f"{node.module}.{alias.name}"
        elif (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
        ):
            assignments.append((node.targets[0].id, node.value))
        elif (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Name)
            and node.value
        ):
            assignments.append((node.target.id, node.value))
    for _ in range(len(assignments) + 1):
        changed = False
        for name, value in assignments:
            resolved = dotted_binding(value, bindings)
            if resolved and bindings.get(name) != resolved:
                bindings[name] = resolved
                changed = True
        if not changed:
            break
    return bindings


def resolve_dynamic_relative(package_context: str, target: str) -> str | None:
    level = len(target) - len(target.lstrip("."))
    remainder = target[level:]
    package_parts = package_context.split(".")
    ascend = level - 1
    if ascend > len(package_parts):
        return None
    base = package_parts[: len(package_parts) - ascend]
    if remainder:
        base.extend(remainder.split("."))
    return ".".join(base)


def scan(
    root: Path, module_root: Path, package: str, project_name: str
) -> dict[str, Any]:
    files = discover_python_files(root, module_root)
    modules_to_files: dict[str, list[Path]] = {}
    for filename in files:
        modules_to_files.setdefault(module_name(module_root, filename), []).append(
            filename
        )
    collisions = {
        name: paths for name, paths in modules_to_files.items() if len(paths) > 1
    }
    if collisions:
        name = sorted(collisions)[0]
        paths = ", ".join(str(path.relative_to(root)) for path in collisions[name])
        fail(f"Python module collision for {name}: {paths}")
    modules = sorted(modules_to_files)
    known_modules = set(modules)
    edges: list[dict[str, Any]] = []
    diagnostics: list[dict[str, Any]] = []
    for filename in files:
        source = module_name(module_root, filename)
        source_is_package = filename.name == "__init__.py"
        try:
            tree = ast.parse(
                filename.read_text(encoding="utf-8"), filename=str(filename)
            )
        except (OSError, SyntaxError) as error:
            diagnostics.append(
                {
                    "source": source,
                    "line": getattr(error, "lineno", 0) or 0,
                    "kind": "parse-error",
                    "detail": str(error),
                }
            )
            continue
        bindings = collect_dynamic_bindings(tree)
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                destructured = any(
                    isinstance(target, (ast.Tuple, ast.List, ast.Starred))
                    for target in node.targets
                )
                if destructured and destructuring_contains_loader(node.value, bindings):
                    diagnostics.append(
                        {
                            "source": source,
                            "line": node.lineno,
                            "kind": "dynamic-loader-destructuring",
                            "detail": "dynamic import loader assigned through tuple/list/starred destructuring",
                        }
                    )
                    continue
            if (
                isinstance(node, ast.AnnAssign)
                and isinstance(node.target, (ast.Tuple, ast.List, ast.Starred))
                and node.value is not None
                and destructuring_contains_loader(node.value, bindings)
            ):
                diagnostics.append(
                    {
                        "source": source,
                        "line": node.lineno,
                        "kind": "dynamic-loader-destructuring",
                        "detail": "dynamic import loader assigned through tuple/list/starred destructuring",
                    }
                )
                continue
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name == package or alias.name.startswith(f"{package}."):
                        edges.append(
                            {
                                "source": source,
                                "target": alias.name,
                                "names": [alias.name],
                                "line": node.lineno,
                                "dynamic": False,
                            }
                        )
                continue
            if isinstance(node, ast.ImportFrom):
                target = resolve_from(source, source_is_package, node)
                names = imported_names(node)
                if target and (target == package or target.startswith(f"{package}.")):
                    ordinary_names: list[str] = []
                    for name in names:
                        candidate = f"{target}.{name}"
                        if candidate in known_modules:
                            edges.append(
                                {
                                    "source": source,
                                    "target": candidate,
                                    "names": [name],
                                    "line": node.lineno,
                                    "dynamic": False,
                                }
                            )
                        else:
                            ordinary_names.append(name)
                    if ordinary_names:
                        edges.append(
                            {
                                "source": source,
                                "target": target,
                                "names": ordinary_names,
                                "line": node.lineno,
                                "dynamic": False,
                            }
                        )
                elif node.level > 0 and target is None:
                    diagnostics.append(
                        {
                            "source": source,
                            "line": node.lineno,
                            "kind": "relative-import-escape",
                            "detail": "relative import escapes the configured package",
                        }
                    )
                continue
            if not isinstance(node, ast.Call):
                continue
            function = dotted_binding(node.func, bindings)
            if function not in {"importlib.import_module", "builtins.__import__"}:
                continue
            argument = node.args[0] if node.args else None
            if not isinstance(argument, ast.Constant) or not isinstance(
                argument.value, str
            ):
                diagnostics.append(
                    {
                        "source": source,
                        "line": node.lineno,
                        "kind": "dynamic-import-nonliteral",
                        "detail": "dynamic import target is not a string literal",
                    }
                )
                continue
            target = argument.value
            if function == "importlib.import_module" and target.startswith("."):
                package_node: ast.expr | None = (
                    node.args[1] if len(node.args) >= 2 else None
                )
                if package_node is None:
                    for keyword in node.keywords:
                        if keyword.arg == "package":
                            package_node = keyword.value
                            break
                if isinstance(package_node, ast.Constant) and isinstance(
                    package_node.value, str
                ):
                    package_context = package_node.value
                elif (
                    isinstance(package_node, ast.Name)
                    and package_node.id == "__package__"
                ):
                    package_context = (
                        source if source_is_package else source.rsplit(".", 1)[0]
                    )
                else:
                    diagnostics.append(
                        {
                            "source": source,
                            "line": node.lineno,
                            "kind": "dynamic-import-nonliteral",
                            "detail": "relative import package is not a literal string or __package__",
                        }
                    )
                    continue
                target = resolve_dynamic_relative(package_context, target)
                if target is None:
                    diagnostics.append(
                        {
                            "source": source,
                            "line": node.lineno,
                            "kind": "relative-import-escape",
                            "detail": "dynamic relative import escapes the configured package",
                        }
                    )
                    continue
            elif function == "builtins.__import__":
                level_node = next(
                    (
                        keyword.value
                        for keyword in node.keywords
                        if keyword.arg == "level"
                    ),
                    None,
                )
                if level_node is None and len(node.args) >= 5:
                    level_node = node.args[4]
                if level_node is not None:
                    if not isinstance(level_node, ast.Constant) or not isinstance(
                        level_node.value, int
                    ):
                        diagnostics.append(
                            {
                                "source": source,
                                "line": node.lineno,
                                "kind": "dynamic-import-nonliteral",
                                "detail": "dynamic import level is not a literal integer",
                            }
                        )
                        continue
                    if level_node.value > 0:
                        package_context = (
                            source if source_is_package else source.rsplit(".", 1)[0]
                        )
                        target = resolve_dynamic_relative(
                            package_context, "." * level_node.value + target
                        )
                        if target is None:
                            diagnostics.append(
                                {
                                    "source": source,
                                    "line": node.lineno,
                                    "kind": "relative-import-escape",
                                    "detail": "dynamic relative import escapes the configured package",
                                }
                            )
                            continue
            if target == package or target.startswith(f"{package}."):
                edges.append(
                    {
                        "source": source,
                        "target": target,
                        "names": [target],
                        "line": node.lineno,
                        "dynamic": True,
                    }
                )
    return {
        "schemaVersion": 2,
        "package": package,
        "projectName": project_name,
        "modules": modules,
        "edges": sorted(
            edges,
            key=lambda edge: (
                edge["source"],
                edge["line"],
                edge["target"],
                edge["dynamic"],
            ),
        ),
        "diagnostics": sorted(
            diagnostics, key=lambda item: (item["source"], item["line"], item["kind"])
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--module-root", required=True)
    parser.add_argument("--package", required=True)
    args = parser.parse_args()
    root_input = Path(args.root).absolute()
    root = root_input.resolve(strict=True)
    project_root_input = root_input / args.project_root
    module_root_input = root_input / args.module_root
    assert_no_symlink_components(root_input, project_root_input, "Python project root")
    assert_no_symlink_components(root_input, module_root_input, "Python module root")
    project_root = project_root_input.resolve(strict=True)
    module_root = module_root_input.resolve(strict=True)
    try:
        project_root.relative_to(root)
        module_root.relative_to(project_root)
    except ValueError:
        fail("Python module root must be contained by its active project root")
    pyproject_path = project_root / "pyproject.toml"
    assert_no_symlink_components(root_input, pyproject_path, "Python pyproject")
    try:
        pyproject = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
        project_name = pyproject["project"]["name"]
    except (OSError, tomllib.TOMLDecodeError, KeyError, TypeError) as error:
        fail(
            f"cannot parse exact [project].name from {pyproject_path.relative_to(root)}: {error}"
        )
    if (
        not isinstance(project_name, str)
        or not project_name.strip()
        or project_name != project_name.strip()
    ):
        fail(f"invalid [project].name in {pyproject_path.relative_to(root)}")
    print(
        json.dumps(
            scan(root, module_root, args.package, project_name),
            sort_keys=True,
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
