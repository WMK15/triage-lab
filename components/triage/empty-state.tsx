import { Sparkles } from "lucide-react";

export function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface px-6 py-10 text-center">
      <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
        <Sparkles className="h-4 w-4" aria-hidden />
      </span>
      <h2 className="text-[15px] font-medium text-foreground">
        No active case
      </h2>
      <p className="mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
        Describe the presenting complaint above. The system will review the
        intake, ask any short follow-up questions it needs, then assign a
        structured triage recommendation.
      </p>
    </div>
  );
}
