import type { EvaluationDetails } from "@/lib/triage/types";

const KTAS_NAMES: Record<number, string> = {
  1: "immediate",
  2: "very urgent",
  3: "urgent",
  4: "standard",
  5: "not urgent",
};

function formatDelta(agent: number, truth: number | null) {
  if (truth == null) return "unscored";
  if (agent === truth) return "exact";
  if (agent < truth) return `+${truth - agent} over`;
  return `-${agent - truth} under`;
}

export function EvaluationCard({ evaluation }: { evaluation: EvaluationDetails }) {
  return (
    <section className="rounded-xl border border-border bg-[var(--surface-secondary)]/35 px-4 py-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Evaluation
          </p>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            {evaluation.summary
              ? `Exact ${(evaluation.summary.exact_rate * 100).toFixed(1)}% · mistriage ${(evaluation.summary.mistriage_rate * 100).toFixed(1)}% · over ${evaluation.summary.over_triage} · under ${evaluation.summary.under_triage}`
              : `Scored ${evaluation.scoredCount} patient${evaluation.scoredCount === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="text-right text-[12px] text-[var(--text-secondary)]">
          <p className="font-mono text-[15px] font-semibold text-foreground">
            {evaluation.compositeScore != null ? evaluation.compositeScore.toFixed(3) : "-"}
          </p>
          <p>Composite</p>
        </div>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] text-[var(--text-secondary)] sm:grid-cols-4">
        <div>
          <dt className="text-[var(--text-muted)]">Base</dt>
          <dd className="font-mono text-foreground">
            {evaluation.baseReward != null ? evaluation.baseReward.toFixed(3) : "-"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--text-muted)]">Ordering</dt>
          <dd className="font-mono text-foreground">
            {evaluation.orderingBonus != null ? `${evaluation.orderingBonus > 0 ? "+" : ""}${evaluation.orderingBonus.toFixed(2)}` : "-"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--text-muted)]">Scored</dt>
          <dd className="font-mono text-foreground">{evaluation.scoredCount}</dd>
        </div>
        <div>
          <dt className="text-[var(--text-muted)]">Manual</dt>
          <dd className="font-mono text-foreground">{evaluation.manualCount}</dd>
        </div>
      </dl>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[var(--text-muted)]">
              <th className="pb-2 pr-2 font-medium">Order</th>
              <th className="pb-2 pr-2 font-medium">Complaint</th>
              <th className="pb-2 pr-2 font-medium">Truth</th>
              <th className="pb-2 pr-2 font-medium">Agent</th>
              <th className="pb-2 pr-2 font-medium">Delta</th>
              <th className="pb-2 pr-0 font-medium">Reward</th>
            </tr>
          </thead>
          <tbody>
            {evaluation.assignments.map((assignment) => (
              <tr key={`${assignment.patient_id}-${assignment.order}`} className="border-t border-border/70">
                <td className="py-2 pr-2 font-mono text-foreground">{assignment.order}</td>
                <td className="py-2 pr-2 text-foreground">
                  <p className="truncate">{assignment.chief_complaint ?? assignment.patient_id}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{assignment.patient_id}</p>
                </td>
                <td className="py-2 pr-2 font-mono text-foreground">
                  {assignment.truth_level != null
                    ? `${assignment.truth_level} · ${KTAS_NAMES[assignment.truth_level]}`
                    : "-"}
                </td>
                <td className="py-2 pr-2 font-mono text-foreground">
                  {assignment.agent_level} · {KTAS_NAMES[assignment.agent_level]}
                </td>
                <td className="py-2 pr-2 font-mono text-[var(--text-secondary)]">
                  {formatDelta(assignment.agent_level, assignment.truth_level)}
                </td>
                <td className="py-2 pr-0 font-mono text-foreground">
                  {assignment.reward != null ? assignment.reward.toFixed(2) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
