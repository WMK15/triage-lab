import { CheckCircle2 } from "lucide-react";
import { KtasBadge } from "./ktas-badge";
import { SeverityBadge } from "./severity-badge";
import type { Decision } from "@/lib/triage/types";

export function DecisionCard({ decision }: { decision: Decision }) {
  return (
    <section
      className="rounded-xl border bg-[var(--decision-bg)] px-4 py-4"
      style={{ borderColor: "var(--decision-border)" }}
    >
      <header className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2
            className="h-4 w-4 text-[var(--decision-text)]"
            aria-hidden
          />
          <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--decision-text)]">
            Decision
          </span>
        </div>
        {decision.ktasLevel ? (
          <KtasBadge level={decision.ktasLevel} />
        ) : (
          <SeverityBadge severity={decision.severity} />
        )}
      </header>

      <h3 className="font-serif text-[19px] font-semibold leading-snug tracking-tight text-[var(--decision-text)]">
        {decision.headline}
      </h3>
      <p className="mt-2 font-serif text-[15px] leading-relaxed text-[var(--decision-text)]/90">
        {decision.rationale}
      </p>
    </section>
  );
}
