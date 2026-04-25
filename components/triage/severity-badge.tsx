import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Severity } from "@/lib/triage/types";

const STYLES: Record<Severity, { label: string; className: string }> = {
  low: {
    label: "Low",
    className: "bg-[var(--decision-bg)] text-[var(--decision-text)] border-[var(--decision-border)]",
  },
  moderate: {
    label: "Moderate",
    className: "bg-[var(--warning-bg)] text-[var(--warning-text)] border-[#fde68a]",
  },
  high: {
    label: "High",
    className: "bg-[var(--error-bg)] text-[var(--error-text)] border-[#fecaca]",
  },
  critical: {
    label: "Critical",
    className:
      "bg-[var(--error-text)] text-white border-[var(--error-text)]",
  },
};

export function SeverityBadge({
  severity,
  className,
}: {
  severity: Severity;
  className?: string;
}) {
  const { label, className: tone } = STYLES[severity];
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        tone,
        className,
      )}
    >
      {label}
    </Badge>
  );
}
