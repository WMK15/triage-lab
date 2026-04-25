import { Activity } from "lucide-react";
import { SeverityBadge } from "./severity-badge";
import type { Severity } from "@/lib/triage/types";

type Props = {
  caseProgress: number;
  severity: Severity | null;
  caseCount: number;
};

export function CaseStatusBar({ caseProgress, severity, caseCount }: Props) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface px-5 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
          <Activity className="h-4 w-4" />
        </span>
        <div className="leading-tight">
          <p className="text-xs uppercase tracking-wider text-[var(--text-muted)]">
            Active case
          </p>
          <p className="text-sm font-medium text-foreground">
            {caseCount === 0
              ? "Awaiting input"
              : `${caseCount} scenario${caseCount === 1 ? "" : "s"} this session`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden sm:flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">Progress</span>
          <div className="relative h-1.5 w-32 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
            <span
              className="absolute inset-y-0 left-0 bg-[var(--accent-hover)] transition-[width] duration-500"
              style={{ width: `${caseProgress}%` }}
            />
          </div>
          <span className="w-9 text-right font-mono text-xs tabular-nums text-[var(--text-secondary)]">
            {caseProgress}%
          </span>
        </div>

        {severity ? (
          <SeverityBadge severity={severity} />
        ) : (
          <span className="text-xs text-[var(--text-muted)]">No severity</span>
        )}
      </div>
    </div>
  );
}
