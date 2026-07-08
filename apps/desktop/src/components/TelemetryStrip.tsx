import type { Telemetry } from "../types";

// §9 Telemetry strip — NOT cosmetic: it controls scheduling. Meters plus the
// live scheduling signals derived from them.
function Meter({
  label,
  pct,
  warn = 90,
}: {
  label: string;
  pct: number;
  warn?: number;
}) {
  const cls = pct >= warn ? "meter danger" : pct >= warn - 15 ? "meter warn" : "meter";
  return (
    <div className="tel-item">
      <span className="tel-label">{label}</span>
      <div className={cls}>
        <div className="meter-fill" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="tel-val">{pct}%</span>
    </div>
  );
}

export default function TelemetryStrip({ telemetry }: { telemetry: Telemetry }) {
  const { vramPct, ramPct, cpuPct, diskIoMbs, tokensPerSec, containers, signals } = telemetry;
  return (
    <footer className="telemetry">
      <Meter label="VRAM" pct={vramPct} />
      <Meter label="RAM" pct={ramPct} />
      <Meter label="CPU" pct={cpuPct} />
      <div className="tel-item">
        <span className="tel-label">Disk I/O</span>
        <span className="tel-val mono">{diskIoMbs} MB/s</span>
      </div>
      <div className="tel-item">
        <span className="tel-label">Tokens/s</span>
        <span className="tel-val mono">{tokensPerSec}</span>
      </div>
      <div className="tel-item">
        <span className="tel-label">Containers</span>
        <span className="tel-val mono">{containers}</span>
      </div>

      <div className="tel-signals">
        <Signal on={signals.embeddingPaused} label="Embedding paused (VRAM>90%)" />
        <Signal on={signals.aiderBlocked} label="Aider blocked (tests running)" />
        <Signal on={signals.forceCompress} label="Graph-RAG compression forced" />
      </div>
    </footer>
  );
}

function Signal({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`signal ${on ? "signal-on" : "signal-off"}`} title="§9 — telemetry controls scheduling">
      <span className="signal-dot" /> {label}
    </span>
  );
}
