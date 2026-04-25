"use client";

import { CheckCircle2, Stethoscope } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ThinkingPanel } from "./thinking-panel";
import { DecisionCard } from "./decision-card";
import { TriageClassifications } from "./triage-classifications";
import { EvaluationCard } from "./evaluation-card";
import type { AgentMessage as AgentMessageData } from "@/lib/triage/types";

type Props = {
  message: AgentMessageData;
};

export function AgentMessage({ message }: Props) {
  const isThinking = message.status === "thinking";

  return (
    <article className="fade-rise space-y-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--surface-secondary)]">
          <Stethoscope
            className="h-3 w-3 text-[var(--text-secondary)]"
            aria-hidden
          />
        </span>
        <span>Triage agent</span>
      </div>

      <Card className="gap-0 rounded-2xl border-border bg-surface p-4 shadow-sm">
        <div className="space-y-4">
          <ThinkingPanel steps={message.thinking} isThinking={isThinking} />

          {message.decision ? (
            <>
              <DecisionCard decision={message.decision} />
              {message.triageClassifications &&
              message.triageClassifications.length > 0 ? (
                <TriageClassifications
                  classifications={message.triageClassifications}
                />
              ) : null}
              {message.evaluation ? <EvaluationCard evaluation={message.evaluation} /> : null}
              {message.acknowledgement ? (
                <div className="flex items-start gap-2.5 rounded-xl border border-[var(--decision-border)] bg-[var(--decision-bg)] px-3.5 py-2.5">
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--decision-text)]"
                    aria-hidden
                  />
                  <div className="leading-snug">
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--decision-text)]">
                      Final response
                    </p>
                    <p className="mt-0.5 text-[13.5px] text-[var(--decision-text)]">
                      {message.acknowledgement}
                    </p>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-[13px] text-[var(--text-muted)]">
              Reasoning… decision will appear once the agent settles on a
              recommendation.
            </p>
          )}
        </div>
      </Card>
    </article>
  );
}
