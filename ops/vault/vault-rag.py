#!/usr/bin/env python3
"""Bounded BM25 index/search CLI for the Jericho Obsidian vault."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import re
import tempfile
from typing import Any

TOKEN = re.compile(r"[\w'-]+", re.UNICODE)
MAX_DOCUMENTS = 50_000
MAX_NOTE_BYTES = 2 * 1024 * 1024
MAX_QUERY_CHARS = 500


def words(value: str) -> list[str]:
    return [item.lower() for item in TOKEN.findall(value)]


def vault_path() -> Path:
    # Preserve the deployed legacy default. The gateway service explicitly
    # configures /opt/brain through VAULT_PATH.
    return Path(os.environ.get(
        "JERICHO_VAULT_PATH", os.environ.get("VAULT_PATH", "/root/brain-vault")
    )).resolve()


def index_path() -> Path:
    return Path(os.environ.get(
        "JERICHO_VAULT_RAG_INDEX",
        os.environ.get("VAULT_RAG_INDEX_PATH", "/opt/data/vault-rag-index/bm25_index.json"),
    )).resolve()


def note_title(path: Path, content: str) -> str:
    for line in content.splitlines():
        if line.startswith("# ") and line[2:].strip():
            return line[2:].strip()[:500]
    return path.stem[:500]


def build_index() -> dict[str, Any]:
    root = vault_path()
    if not root.is_dir():
        raise SystemExit("vault path is unavailable")
    documents: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*.md")):
        if len(documents) >= MAX_DOCUMENTS:
            break
        if any(part in {".git", ".obsidian"} for part in path.parts):
            continue
        try:
            resolved = path.resolve(strict=True)
            if root not in resolved.parents or resolved.stat().st_size > MAX_NOTE_BYTES:
                continue
            content = resolved.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        tokens = words(content)
        frequencies: dict[str, int] = {}
        for token in tokens:
            frequencies[token] = frequencies.get(token, 0) + 1
        documents.append({
            "path": resolved.relative_to(root).as_posix(),
            "title": note_title(resolved, content),
            "content": content[:MAX_NOTE_BYTES],
            "length": len(tokens),
            "terms": frequencies,
        })
    payload = {
        "version": 1,
        "documents": documents,
        "average_length": (
            sum(item["length"] for item in documents) / len(documents)
            if documents else 0
        ),
    }
    target = index_path()
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=target.parent, delete=False
    ) as temporary:
        json.dump(payload, temporary, ensure_ascii=False, separators=(",", ":"))
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    temporary_path.chmod(0o600)
    temporary_path.replace(target)
    return {
        "documents": len(documents),
        "index_size_mb": target.stat().st_size / (1024 * 1024),
    }


def load_index() -> dict[str, Any]:
    try:
        payload = json.loads(index_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit("RAG index is unavailable; run index first") from error
    if payload.get("version") != 1 or not isinstance(payload.get("documents"), list):
        raise SystemExit("RAG index schema is invalid")
    return payload


def excerpt(content: str, query_tokens: list[str]) -> str:
    lowered = content.lower()
    positions = [lowered.find(token) for token in query_tokens]
    positions = [position for position in positions if position >= 0]
    start = max(0, (min(positions) if positions else 0) - 120)
    return re.sub(r"\s+", " ", content[start:start + 500]).strip()


def search(query: str, limit: int) -> list[dict[str, Any]]:
    normalized = re.sub(r"\s+", " ", query).strip()
    if not normalized or len(normalized) > MAX_QUERY_CHARS:
        raise SystemExit("query is invalid")
    query_tokens = words(normalized)
    payload = load_index()
    documents = payload["documents"]
    average_length = float(payload.get("average_length") or 1)
    document_frequency = {
        token: sum(1 for document in documents if token in document.get("terms", {}))
        for token in set(query_tokens)
    }
    scored: list[tuple[float, dict[str, Any]]] = []
    for document in documents:
        score = 0.0
        length = max(1, int(document.get("length", 0)))
        terms = document.get("terms", {})
        for token in query_tokens:
            frequency = int(terms.get(token, 0))
            if not frequency:
                continue
            frequency_docs = document_frequency[token]
            inverse = math.log(1 + (len(documents) - frequency_docs + 0.5) / (frequency_docs + 0.5))
            denominator = frequency + 1.5 * (1 - 0.75 + 0.75 * length / average_length)
            score += inverse * (frequency * 2.5 / denominator)
        if score > 0:
            scored.append((score, document))
    scored.sort(key=lambda item: (-item[0], item[1]["path"]))
    return [{
        "path": document["path"],
        "title": document["title"],
        "excerpt": excerpt(document["content"], query_tokens),
        "score": round(score, 6),
    } for score, document in scored[:limit]]


def legacy_search(query: str, limit: int) -> list[dict[str, Any]]:
    """Preserve the live `search QUERY -n N` JSON-array contract."""
    normalized = re.sub(r"\s+", " ", query).strip()
    if not normalized or len(normalized) > MAX_QUERY_CHARS:
        raise SystemExit("query is invalid")
    root = vault_path()
    if not root.is_dir():
        raise SystemExit("vault path is unavailable")
    needle = normalized.casefold()
    results: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*.md")):
        if any(part in {".git", ".obsidian"} for part in path.parts):
            continue
        try:
            resolved = path.resolve(strict=True)
            if root not in resolved.parents or resolved.stat().st_size > MAX_NOTE_BYTES:
                continue
            lines = resolved.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeError):
            continue
        matching = next((line.strip() for line in lines if needle in line.casefold()), None)
        if matching is None:
            continue
        title = re.sub(r"^[\d\s\-_.]+", "", resolved.stem).strip() or resolved.name
        results.append({
            "title": title,
            "content": matching[:200],
            "path": resolved.relative_to(root).as_posix(),
            "score": round(max(0.0, 1.0 - len(results) * 0.05), 6),
        })
        if len(results) >= limit:
            break
    return results


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    actions = command.add_subparsers(dest="action", required=True)
    index = actions.add_parser("index")
    index.add_argument("--json", action="store_true")
    query = actions.add_parser("search")
    query.add_argument("query")
    query.add_argument("-n", "--limit", type=int, default=5, choices=range(1, 51))
    query.add_argument("--json", action="store_true")
    return command


def main() -> None:
    arguments = parser().parse_args()
    if arguments.action == "index":
        result: Any = build_index()
    elif arguments.json:
        result = {"results": search(arguments.query, arguments.limit)}
    else:
        result = legacy_search(arguments.query, arguments.limit)
    if arguments.json or arguments.action == "search":
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    else:
        print(f"Indexed {result['documents']} documents ({result['index_size_mb']:.2f} MB)")


if __name__ == "__main__":
    main()
