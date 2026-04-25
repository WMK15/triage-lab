import { formatKtasLabel } from "@/lib/triage/ktas";
import type { TriageClassification } from "@/lib/triage/types";

function resultLabel(item: TriageClassification) {
  if (item.truthLevel == null) return "unscored";
  if (item.agentLevel === item.truthLevel) return "exact";
  return item.agentLevel < item.truthLevel ? "over-triage" : "UNDER-triage";
}

export function TriageClassifications({
  classifications,
}: {
  classifications: TriageClassification[];
}) {
  if (classifications.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-[var(--surface-secondary)]/35 px-4 py-3">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Triage Classifications
          </p>
          <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
            Agent KTAS assignment for each patient in this run.
          </p>
        </div>
        <span className="rounded-full bg-surface px-2.5 py-1 font-mono text-[11px] text-[var(--text-muted)]">
          {classifications.length} patient{classifications.length === 1 ? "" : "s"}
        </span>
      </header>

      <div className="space-y-2">
        {classifications
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((item) => (
            <div
              key={item.patientId}
              className="rounded-lg border border-border bg-surface px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-[12px] text-foreground">
                    {item.patientId}
                    <span className="ml-2 font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                      {item.source}{item.scored ? "" : " - unscored"}
                    </span>
                  </p>
                  {item.chiefComplaint ? (
                    <p className="mt-0.5 truncate text-[12.5px] text-[var(--text-secondary)]">
                      {item.chiefComplaint}
                    </p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="font-mono text-[13px] font-semibold text-foreground">
                    KTAS {item.agentLevel}
                  </p>
                  <p className="text-[11.5px] text-[var(--text-muted)]">
                    {formatKtasLabel(item.agentLevel)}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--text-muted)]">
                <span className="rounded-full bg-[var(--surface-secondary)] px-2 py-0.5">
                  Result: {resultLabel(item)}
                </span>
                {item.truthLevel != null ? (
                  <span className="rounded-full bg-[var(--surface-secondary)] px-2 py-0.5">
                    Truth KTAS {item.truthLevel}
                  </span>
                ) : null}
                {item.reward != null ? (
                  <span className="rounded-full bg-[var(--surface-secondary)] px-2 py-0.5">
                    Reward {item.reward.toFixed(2)}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}
