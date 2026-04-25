import { ENVIRONMENT_OPTIONS } from "@/lib/triage/mock-agent";
import type { UserMessage as UserMessageData } from "@/lib/triage/types";

export function UserMessage({ message }: { message: UserMessageData }) {
  const env = ENVIRONMENT_OPTIONS.find((o) => o.value === message.environment);

  return (
    <div className="fade-rise flex justify-end">
      <div className="max-w-[80%] space-y-1.5">
        <div className="flex items-center justify-end gap-2 text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          <span>You</span>
          <span aria-hidden>·</span>
          <span>{env?.label ?? "General"}</span>
        </div>
        <div className="rounded-2xl rounded-tr-md border border-border bg-surface px-4 py-3 font-serif text-[15.5px] leading-relaxed text-foreground shadow-sm">
          {message.scenario}
        </div>
      </div>
    </div>
  );
}
