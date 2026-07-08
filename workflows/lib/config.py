"""Service endpoints for the air-gapped backplane (deploy/docker-compose.yml).

All defaults point at the internal compose network. Nothing here reaches the
internet (CLAUDE.md §11). Override via env for local dev.
"""

import os

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://ollama:11434")
QDRANT_URL = os.environ.get("QDRANT_URL", "http://qdrant:6333")
MEMGRAPH_URL = os.environ.get("MEMGRAPH_URL", "bolt://memgraph:7687")
GITEA_URL = os.environ.get("GITEA_URL", "http://gitea:3000")
OPENHANDS_URL = os.environ.get("OPENHANDS_URL", "http://openhands:3000")
TEMPORAL_ADDRESS = os.environ.get("TEMPORAL_ADDRESS", "temporal:7233")
TEMPORAL_TASK_QUEUE = os.environ.get("KEYSTONE_TASK_QUEUE", "keystone-missions")

# Filesystem layout (CLAUDE.md §5).
MAIN_REPO = os.environ.get("KEYSTONE_MAIN_REPO", "/main-repo")
WORKSPACES = os.environ.get("KEYSTONE_WORKSPACES", "/workspaces")
LEDGER = os.environ.get("KEYSTONE_LEDGER", "/.keystone/ledger.jsonl")

# §7 loop governor.
MAX_ATTEMPTS = int(os.environ.get("KEYSTONE_MAX_ATTEMPTS", "3"))
MAX_SAME_ERROR = int(os.environ.get("KEYSTONE_MAX_SAME_ERROR", "2"))

AIRGAP = os.environ.get("KEYSTONE_AIRGAP", "1") not in ("0", "false", "False")
