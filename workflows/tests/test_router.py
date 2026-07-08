"""Unit tests for the agent router (lib/agent_router.py).

Covers the offline lexical path and the embedding path (with a fake embedder),
so both routing modes are verified with zero network.

Run:  python -m unittest tests.test_router
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lib.agent_router import route  # noqa: E402

AGENTS = [
    {"id": "eng/backend-architect", "division": "engineering", "name": "Backend Architect",
     "vibe": "Designs the systems that hold everything up — databases, APIs, auth.",
     "description": "Backend systems, API design, JWT auth, databases, scalability."},
    {"id": "sec/security-auditor", "division": "security", "name": "Security Auditor",
     "vibe": "Assume breach. Prove it can't happen.",
     "description": "Threat modeling, token validation, vulnerability review."},
    {"id": "design/ui-designer", "division": "design", "name": "UI Designer",
     "vibe": "Interfaces that feel inevitable.",
     "description": "Visual design, components, color, layout, accessibility."},
]


class TestRouter(unittest.TestCase):
    def test_lexical_picks_relevant_agent(self):
        res = route("reject JWTs with alg=none, harden token auth", AGENTS)
        self.assertTrue(res)
        # "auth"/"token"/"jwt" should surface a backend/security agent, not the designer.
        self.assertIn(res[0]["agent"]["division"], {"engineering", "security"})
        self.assertNotEqual(res[0]["agent"]["id"], "design/ui-designer")

    def test_name_match_wins(self):
        res = route("need a security auditor", AGENTS)
        self.assertEqual(res[0]["agent"]["id"], "sec/security-auditor")

    def test_norm_is_relative_to_top(self):
        res = route("api database auth", AGENTS)
        self.assertAlmostEqual(res[0]["norm"], 1.0)
        self.assertTrue(all(r["norm"] <= 1.0 for r in res))

    def test_no_match_returns_empty(self):
        self.assertEqual(route("xyzzy qwerty", AGENTS), [])

    def test_embedding_path_with_fake_embedder(self):
        # Fake embedder: 3-dim bag-of-keywords vector. Cosine should rank the
        # agent whose profile shares keywords with the query first.
        def embed(text: str):
            t = text.lower()
            return [
                float(t.count("auth") + t.count("jwt") + t.count("token")),
                float(t.count("design") + t.count("color") + t.count("layout")),
                float(t.count("security") + t.count("threat") + t.count("breach")),
            ]

        res = route("jwt auth token hardening", AGENTS, embed=embed)
        self.assertEqual(res[0]["agent"]["id"], "eng/backend-architect")


if __name__ == "__main__":
    unittest.main()
