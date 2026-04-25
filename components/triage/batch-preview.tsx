"use client";

import { useEffect, useState } from "react";

import type { PatientPreview } from "@/lib/triage/types";

const KTAS_NAMES: Record<number, string> = {
  1: "immediate",
  2: "very_urgent",
  3: "urgent",
  4: "standard",
  5: "not_urgent",
};

type Props = {
  taskId: string;
  batchSize: number;
};

export function BatchPreview({ taskId, batchSize }: Props) {
  const [patients, setPatients] = useState<PatientPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;

    void (async () => {
      // Loading flag and error reset live inside the async block so React's
      // set-state-in-effect rule isn't tripped (cascade-render risk).
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await fetch("/api/triage/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, batchSize }),
        });
        const payload = (await res.json()) as
          | { patients: PatientPreview[] }
          | { error: string };
        if (!res.ok) {
          if (!cancelled) setError("error" in payload ? payload.error : "preview failed");
          return;
        }
        if (!cancelled && "patients" in payload) {
          setPatients(payload.patients);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "preview failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [taskId, batchSize]);

  if (error) {
    return (
      <div className="rounded-xl border border-[var(--error-border)] bg-[var(--error-bg)] px-3 py-2 text-[12px] text-[var(--error-text)]">
        Could not load preview: {error}
      </div>
    );
  }

  if (loading || !patients) {
    return (
      <div className="rounded-xl border border-border bg-[var(--surface-secondary)]/40 px-3 py-2 text-[12px] text-[var(--text-muted)]">
        Loading preview…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-[var(--surface-secondary)]/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Preview — {patients.length} patient{patients.length === 1 ? "" : "s"}
      </p>
      <ul className="mt-2 space-y-1">
        {patients.map((p) => (
          <li
            key={p.id}
            className="flex items-baseline justify-between gap-3 font-mono text-[12px] leading-relaxed text-foreground"
          >
            <span className="truncate">
              <span className="text-[var(--text-muted)]">{p.id}</span>{" "}
              <span className="text-[var(--text-secondary)]">
                age {p.age} {p.sex}
              </span>{" "}
              — {p.chief_complaint}
            </span>
            <span className="shrink-0 rounded-md bg-[var(--accent)]/15 px-1.5 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
              {p.ground_truth_ktas != null
                ? `KTAS ${p.ground_truth_ktas} · ${KTAS_NAMES[p.ground_truth_ktas]}`
                : "unscored"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
