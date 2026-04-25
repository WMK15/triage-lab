"use client";

import { useState } from "react";
import { Brain, ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ThinkingStep } from "@/lib/triage/types";

type Props = {
  steps: ThinkingStep[];
  isThinking: boolean;
};

export function ThinkingPanel({ steps, isThinking }: Props) {
  const [open, setOpen] = useState(false);
  const activeStep = steps[steps.length - 1] ?? null;
  const isOpen = isThinking ? steps.length > 0 : open;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setOpen}
      className="rounded-xl border border-[var(--thinking-border)] bg-[var(--thinking-bg)]"
    >
      <CollapsibleTrigger
        className="group flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left disabled:cursor-not-allowed"
      >
        <div className="flex items-center gap-2.5">
          <Brain
            className="h-4 w-4 text-[var(--thinking-text)]"
            aria-hidden
          />
          <span className="text-[13px] font-medium uppercase tracking-wider text-[var(--thinking-text)]">
            Thinking
          </span>
          {isThinking ? (
            <>
              <span
                className="dot-pulse ml-1"
                role="status"
                aria-label="Reasoning in progress"
              >
                <span />
                <span />
                <span />
              </span>
              {activeStep ? (
                <span className="max-w-[28rem] truncate text-xs text-[var(--text-muted)]">
                  {activeStep.label}: {activeStep.detail}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-xs text-[var(--text-muted)]">
              · {steps.length} step{steps.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {!isThinking && (
          <ChevronDown
            className={cn(
              "h-4 w-4 text-[var(--thinking-text)] transition-transform",
              isOpen && "rotate-180",
            )}
            aria-hidden
          />
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0">
        <ol className="space-y-3 border-t border-[var(--thinking-border)] px-4 py-3.5">
          {steps.map((step, index) => (
            <li key={step.id} className="flex gap-3">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface font-mono text-[10px] font-medium text-[var(--thinking-text)] ring-1 ring-[var(--thinking-border)]">
                {index + 1}
              </span>
              <div className="space-y-0.5">
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">
                  {step.label}
                </p>
                <p className="text-[13px] leading-relaxed text-[var(--thinking-text)]">
                  {step.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
