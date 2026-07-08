// The Agency (msitarzewski/agency-agents, MIT) integrated as KeyStoneOS's agent
// roster — the §10 Phase-3 "LangGraph team", but 218 specialists across 16
// divisions. The metadata index is bundled (instant browse/search); each agent's
// full system-prompt body is fetched lazily from public/ (airgap-friendly).

import indexJson from "../data/agency-index.json";

export interface AgencyDivision {
  id: string;
  label: string;
  icon: string;
  color: string;
  count: number;
}

export interface AgencyAgent {
  id: string;
  division: string;
  name: string;
  description: string;
  emoji: string;
  vibe: string;
  color: string;
}

interface AgencyIndex {
  source: string;
  license: string;
  divisions: AgencyDivision[];
  agents: AgencyAgent[];
}

export const agency = indexJson as AgencyIndex;

export function searchAgents(query: string, division: string | null): AgencyAgent[] {
  const q = query.trim().toLowerCase();
  return agency.agents.filter((a) => {
    if (division && a.division !== division) return false;
    if (!q) return true;
    return (
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.vibe.toLowerCase().includes(q) ||
      a.division.toLowerCase().includes(q)
    );
  });
}

let _bodies: Record<string, string> | null = null;
let _loading: Promise<Record<string, string>> | null = null;

/** Lazy-load the full prompt-body map once, then resolve from cache. */
export async function getAgentBody(id: string): Promise<string> {
  if (_bodies) return _bodies[id] ?? "";
  if (!_loading) {
    _loading = fetch("/agency-bodies.json")
      .then((r) => r.json())
      .then((b: Record<string, string>) => {
        _bodies = b;
        return b;
      })
      .catch((err) => {
        // Don't cache a rejected promise — allow a later retry.
        _loading = null;
        throw err;
      });
  }
  const bodies = await _loading;
  return bodies[id] ?? "";
}
