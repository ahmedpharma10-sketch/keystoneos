// Agent router — pick the best Agency lead for a typed mission request.
// This is the offline, in-UI counterpart of the backend semantic router
// (workflows/lib/agent_router.py, which embeds via Ollama). Here we score by
// field-weighted term overlap so routing works with zero network (§11) and is
// deterministic. Same shape of result: ranked candidates with a score + why.

import type { AgencyAgent } from "./agency";

const STOP = new Set([
  "the", "a", "an", "to", "of", "in", "for", "and", "with", "on", "add", "fix",
  "make", "build", "create", "that", "this", "is", "it", "my", "our", "using",
  "into", "from", "help", "need", "want", "please", "app",
]);

function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length > 2 && !STOP.has(t)
  );
}

export interface RouteResult {
  agent: AgencyAgent;
  score: number; // raw
  norm: number; // 0..1 vs the top match
  matched: string[];
}

// Field weights: a hit in the name is worth more than one in the description.
const W = { name: 3, vibe: 2, desc: 1.5, division: 1 };

export function routeAgent(query: string, agents: AgencyAgent[], topN = 5): RouteResult[] {
  const qt = tokens(query);
  if (qt.length === 0) return [];

  const scored = agents
    .map((a) => {
      const name = a.name.toLowerCase();
      const vibe = (a.vibe || "").toLowerCase();
      const desc = (a.description || "").toLowerCase();
      const div = a.division.toLowerCase();
      let score = 0;
      const matched = new Set<string>();
      for (const t of qt) {
        if (name.includes(t)) {
          score += W.name;
          matched.add(t);
        } else if (vibe.includes(t)) {
          score += W.vibe;
          matched.add(t);
        } else if (desc.includes(t)) {
          score += W.desc;
          matched.add(t);
        } else if (div.includes(t)) {
          score += W.division;
          matched.add(t);
        }
      }
      return { agent: a, score, matched: [...matched] };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  const max = scored[0]?.score || 1;
  return scored.map((s) => ({ ...s, norm: s.score / max }));
}
