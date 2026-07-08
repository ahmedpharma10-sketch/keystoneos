#!/usr/bin/env python3
"""Import the Agency (msitarzewski/agency-agents, MIT) into a KeyStoneOS catalog.

Parses each division's agent .md frontmatter (name/description/emoji/vibe/color)
+ system-prompt body and emits a single agency.json the desktop app bundles
(airgap-friendly, §11 — no network at runtime). Divisions come from the repo's
divisions.json (the repo's own source of truth).

Emits two files so the 3MB of prompt bodies never bloats the JS bundle:
  * <index_out>  — divisions + agent metadata (bundled, instant browse/search)
  * <bodies_out> — {id: body} map (served from public/, fetched lazily on view)

    python3 scripts/import_agency.py <repo> \\
        apps/desktop/src/data/agency-index.json \\
        apps/desktop/public/agency-bodies.json
"""

import json
import os
import re
import sys


def parse_frontmatter(text: str):
    """Return (meta dict, body str) for a `---`-delimited frontmatter file."""
    if not text.startswith("---"):
        return None, text
    end = text.find("\n---", 3)
    if end == -1:
        return None, text
    block = text[3:end].strip("\n")
    body = text[end + 4:].lstrip("\n")
    meta = {}
    for line in block.splitlines():
        if ":" in line and not line.startswith(" "):
            k, _, v = line.partition(":")
            meta[k.strip()] = v.strip().strip('"')
    return meta, body


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main():
    repo, index_out, bodies_out = sys.argv[1], sys.argv[2], sys.argv[3]
    divisions = json.load(open(os.path.join(repo, "divisions.json")))["divisions"]

    agents = []
    bodies = {}
    div_out = []
    for div_id, meta in divisions.items():
        ddir = os.path.join(repo, div_id)
        if not os.path.isdir(ddir):
            continue
        count = 0
        for fn in sorted(os.listdir(ddir)):
            if not fn.endswith(".md") or fn.upper().startswith("README"):
                continue
            fm, body = parse_frontmatter(open(os.path.join(ddir, fn)).read())
            if not fm or "name" not in fm:
                continue
            aid = f"{div_id}/{slug(fn[:-3])}"
            agents.append({
                "id": aid,
                "division": div_id,
                "name": fm.get("name", fn[:-3]),
                "description": fm.get("description", ""),
                "emoji": fm.get("emoji", "🤖"),
                "vibe": fm.get("vibe", ""),
                "color": meta.get("color", "#6366F1"),
            })
            bodies[aid] = body.strip()
            count += 1
        div_out.append({"id": div_id, "label": meta["label"], "icon": meta["icon"],
                        "color": meta["color"], "count": count})

    index = {
        "source": "https://github.com/msitarzewski/agency-agents",
        "license": "MIT",
        "divisions": [d for d in div_out if d["count"] > 0],
        "agents": agents,
    }
    for path, data in ((index_out, index), (bodies_out, bodies)):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        json.dump(data, open(path, "w"), ensure_ascii=False)
    print(f"index: {len(index['divisions'])} divisions, {len(agents)} agents -> {index_out}")
    print(f"bodies: {len(bodies)} -> {bodies_out}")


if __name__ == "__main__":
    main()
