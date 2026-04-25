import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatKtasLabel } from "@/lib/triage/ktas";
import type { KtasLevel } from "@/lib/triage/types";

const STYLES: Record<KtasLevel, string> = {
  1: "bg-[var(--error-text)] text-white border-[var(--error-text)]",
  2: "bg-[var(--error-bg)] text-[var(--error-text)] border-[#fecaca]",
  3: "bg-[var(--warning-bg)] text-[var(--warning-text)] border-[#fde68a]",
  4: "bg-[var(--decision-bg)] text-[var(--decision-text)] border-[var(--decision-border)]",
  5: "bg-[var(--surface-secondary)] text-[var(--text-secondary)] border-border",
};

export function KtasBadge({ level, className }: { level: KtasLevel; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        STYLES[level],
        className,
      )}
    >
      {formatKtasLabel(level)}
    </Badge>
  );
}
