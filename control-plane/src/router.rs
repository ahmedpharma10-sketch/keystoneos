//! Model Router (CLAUDE.md §1, §9) — picks an Ollama model for a job class while
//! respecting live VRAM / tokens-per-sec / queue-depth. Telemetry is not
//! cosmetic: when VRAM is tight the router refuses to load another model and
//! steers work to an already-resident one.

#[derive(Clone, Debug)]
pub struct ModelCard {
    pub name: String,
    pub vram_gb: f32,
    pub resident: bool,
    pub tokens_per_sec: f32,
}

#[derive(Clone, Copy, Debug)]
pub enum JobClass {
    Plan,
    Edit,
    Embed,
    Review,
}

pub struct Router {
    pub models: Vec<ModelCard>,
    pub vram_total_gb: f32,
    pub vram_used_gb: f32,
    pub queue_depth: u32,
}

impl Router {
    fn headroom(&self) -> f32 {
        (self.vram_total_gb - self.vram_used_gb).max(0.0)
    }

    fn vram_pct(&self) -> f32 {
        if self.vram_total_gb <= 0.0 {
            0.0
        } else {
            100.0 * self.vram_used_gb / self.vram_total_gb
        }
    }

    /// Choose a model for the job. Prefers resident models; only loads a new one
    /// if there is VRAM headroom for it (§9: VRAM > 90% pauses new loads).
    pub fn pick(&self, job: JobClass) -> Option<&ModelCard> {
        let prefer_small = matches!(job, JobClass::Embed | JobClass::Review);

        // Under VRAM pressure, never load a new model — reuse what's resident.
        let pressured = self.vram_pct() > 90.0;
        let mut candidates: Vec<&ModelCard> = self
            .models
            .iter()
            .filter(|m| {
                if m.resident {
                    return true;
                }
                !pressured && m.vram_gb <= self.headroom()
            })
            .collect();

        if candidates.is_empty() {
            return None;
        }

        candidates.sort_by(|a, b| {
            // Resident first; then smaller for embed/review, faster otherwise.
            let key_a = (!a.resident as u8, if prefer_small { a.vram_gb } else { -a.tokens_per_sec });
            let key_b = (!b.resident as u8, if prefer_small { b.vram_gb } else { -b.tokens_per_sec });
            key_a.partial_cmp(&key_b).unwrap()
        });
        candidates.first().copied()
    }

    /// §9 scheduling signal: pause embedding jobs when VRAM is saturated.
    pub fn embedding_paused(&self) -> bool {
        self.vram_pct() > 90.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn router(used: f32) -> Router {
        Router {
            models: vec![
                ModelCard { name: "qwen2.5-coder:32b".into(), vram_gb: 20.0, resident: true, tokens_per_sec: 60.0 },
                ModelCard { name: "nomic-embed-text".into(), vram_gb: 1.0, resident: false, tokens_per_sec: 0.0 },
            ],
            vram_total_gb: 24.0,
            vram_used_gb: used,
            queue_depth: 0,
        }
    }

    #[test]
    fn under_pressure_reuses_resident() {
        let r = router(23.0); // ~96%
        assert!(r.embedding_paused());
        assert_eq!(r.pick(JobClass::Plan).unwrap().name, "qwen2.5-coder:32b");
    }

    #[test]
    fn with_headroom_can_load_embedder() {
        let r = router(20.0);
        assert_eq!(r.pick(JobClass::Embed).unwrap().name, "nomic-embed-text");
    }
}
