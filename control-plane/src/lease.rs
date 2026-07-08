//! Workspace Lease Manager (CLAUDE.md §5) — canonical authority.
//!
//! Mirrors workflows/lib/leases.py exactly: two leases conflict iff their scopes
//! overlap AND at least one is exclusive (write / test_env / migration). This is
//! what makes "Aider edits while OpenHands compiles" structurally impossible.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

static SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    Read,
    Write,
    TestEnv,
    Vault,
    Migration,
}

impl Kind {
    fn exclusive(&self) -> bool {
        matches!(self, Kind::Write | Kind::TestEnv | Kind::Migration)
    }
}

#[derive(Clone, Debug)]
pub struct Lease {
    pub token: String,
    pub mission_id: String,
    pub kind: Kind,
    pub scope: String,
}

#[derive(Default)]
pub struct LeaseManager {
    held: HashMap<String, Lease>,
    queue: Vec<(String, Kind, String)>,
}

fn overlap(a: &str, b: &str) -> bool {
    let a = a.trim_end_matches('/');
    let b = b.trim_end_matches('/');
    a == b || a.starts_with(&format!("{b}/")) || b.starts_with(&format!("{a}/"))
}

impl LeaseManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn conflict(&self, kind: &Kind, scope: &str) -> Option<&Lease> {
        self.held.values().find(|l| {
            overlap(scope, &l.scope) && (kind.exclusive() || l.kind.exclusive())
        })
    }

    /// Returns `Some(lease)` or `None` if the request was queued (scope busy).
    pub fn acquire(&mut self, mission_id: &str, kind: Kind, scope: &str) -> Option<Lease> {
        if self.conflict(&kind, scope).is_some() {
            self.queue.push((mission_id.to_string(), kind, scope.to_string()));
            return None;
        }
        let token = format!("lease-{}", SEQ.fetch_add(1, Ordering::SeqCst));
        let lease = Lease {
            token: token.clone(),
            mission_id: mission_id.to_string(),
            kind,
            scope: scope.to_string(),
        };
        self.held.insert(token, lease.clone());
        Some(lease)
    }

    pub fn release(&mut self, token: &str) {
        self.held.remove(token);
        if let Some(idx) = self
            .queue
            .iter()
            .position(|(_, k, s)| self.conflict(k, s).is_none())
        {
            let (m, k, s) = self.queue.remove(idx);
            self.acquire(&m, k, &s);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_blocks_overlapping_test_env() {
        let mut m = LeaseManager::new();
        assert!(m.acquire("ks-001", Kind::Write, "src/").is_some());
        assert!(m.acquire("ks-001", Kind::TestEnv, "src/auth/").is_none());
    }

    #[test]
    fn reads_coexist() {
        let mut m = LeaseManager::new();
        assert!(m.acquire("a", Kind::Read, "src/").is_some());
        assert!(m.acquire("b", Kind::Read, "src/").is_some());
    }
}
