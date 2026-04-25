"use client";

import { ArrowUpRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Action } from "@/lib/triage/types";

type Props = {
  actions: Action[];
  selectedActionId: string | null;
  onSelect: (actionId: string) => void;
};

export function ActionChoices({ actions, selectedActionId, onSelect }: Props) {
  const isCommitted = selectedActionId !== null;

  return (
    <section>
      <header className="mb-2.5 flex items-center gap-2">
        <ArrowUpRight
          className="h-4 w-4 text-[var(--text-secondary)]"
          aria-hidden
        />
        <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Next actions
        </span>
        <span className="text-[12px] text-[var(--text-muted)]">
          {isCommitted ? "· committed" : "· select one"}
        </span>
      </header>

      <ul className="grid gap-2 sm:grid-cols-2">
        {actions.map((action, index) => {
          const isSelected = selectedActionId === action.id;
          const isDimmed = isCommitted && !isSelected;
          return (
            <li key={action.id}>
              <button
                type="button"
                onClick={() => onSelect(action.id)}
                disabled={isCommitted}
                aria-pressed={isSelected}
                className={cn(
                  "group flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
                  "border-transparent bg-[var(--surface-secondary)]",
                  !isCommitted && "hover:bg-[#e2e8e5]",
                  isSelected &&
                    "border-[var(--accent-hover)] bg-[var(--accent)]",
                  isDimmed && "opacity-50",
                  isCommitted && "cursor-not-allowed",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-[10px] font-medium",
                    isSelected
                      ? "bg-white/70 text-[var(--accent-foreground)]"
                      : "bg-surface text-[var(--text-secondary)] ring-1 ring-[var(--thinking-border)]",
                  )}
                >
                  {isSelected ? (
                    <Check className="h-3 w-3" aria-hidden />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-[14px] font-medium",
                      isSelected
                        ? "text-[var(--accent-foreground)]"
                        : "text-foreground",
                    )}
                  >
                    {action.label}
                  </span>
                  {action.description ? (
                    <span
                      className={cn(
                        "mt-0.5 block text-[12.5px] leading-relaxed",
                        isSelected
                          ? "text-[var(--accent-foreground)]/80"
                          : "text-[var(--text-secondary)]",
                      )}
                    >
                      {action.description}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
