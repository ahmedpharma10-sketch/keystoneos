"""Local LLM client — OpenAI-compatible gate (the warehouse at :4317/v1).

Powers the Hyper-Extract LLM path (ingest/extract.py). Stdlib-only, airgap-safe:
talks to the local gate, never the internet (§11). Returns raw text; callers
parse JSON.
"""

from __future__ import annotations

import json
import os
import urllib.request

GATE_URL = os.environ.get("KEYSTONE_LLM_URL", "http://localhost:4317/v1")
GATE_MODEL = os.environ.get("KEYSTONE_LLM_MODEL", "role:general")


def chat(prompt: str, model: str | None = None, temperature: float = 0.0,
         want_json: bool = True, timeout: int = 180) -> str:
    """One-shot chat completion against the local gate. Returns the message text."""
    body = {
        "model": model or GATE_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temperature,
        "stream": False,
    }
    if want_json:
        body["response_format"] = {"type": "json_object"}
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{GATE_URL}/chat/completions", data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (local gate)
        out = json.loads(resp.read().decode())
    return out["choices"][0]["message"]["content"]


def make_extractor(model: str | None = None, timeout: int = 300):
    """Return a `text -> raw_json_str` callable for extract(text, llm=...).
    Generous timeout absorbs a cold model reload by the gate mid-run."""
    return lambda prompt: chat(prompt, model=model, want_json=True, timeout=timeout)
