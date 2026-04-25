"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical } from "lucide-react";

import { CaseStatusBar } from "@/components/triage/case-status-bar";
import { InputPanel } from "@/components/triage/input-panel";
import { UserMessage } from "@/components/triage/user-message";
import { AgentMessage } from "@/components/triage/agent-message";
import { EmptyState } from "@/components/triage/empty-state";
import {
  generateAgentResponse,
  generateActionOutcome,
} from "@/lib/triage/mock-agent";
import type {
  AgentMessage as AgentMessageData,
  EnvironmentType,
  Message,
} from "@/lib/triage/types";

const THINKING_DELAY_MS = 2200;

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function TriageLabPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the message column when new messages arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const latestAgent = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "agent" && m.decision) return m;
    }
    return null;
  }, [messages]);

  const userScenarioCount = useMemo(
    () => messages.filter((m) => m.role === "user").length,
    [messages],
  );

  const handleSubmit = useCallback(
    (scenario: string, environment: EnvironmentType) => {
      const userId = makeId();
      const agentId = makeId();
      const now = Date.now();

      const placeholder: AgentMessageData = {
        id: agentId,
        role: "agent",
        status: "thinking",
        thinking: [],
        decision: null,
        actions: [],
        selectedActionId: null,
        acknowledgement: null,
        createdAt: now,
      };

      setMessages((prev) => [
        ...prev,
        {
          id: userId,
          role: "user",
          scenario,
          environment,
          createdAt: now,
        },
        placeholder,
      ]);
      setIsRunning(true);

      const timeout = setTimeout(() => {
        const response = generateAgentResponse(scenario, environment);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentId && m.role === "agent"
              ? {
                  ...m,
                  status: "ready",
                  thinking: response.thinking,
                  decision: response.decision,
                  actions: response.actions,
                }
              : m,
          ),
        );
        setIsRunning(false);
      }, THINKING_DELAY_MS);

      return () => clearTimeout(timeout);
    },
    [],
  );

  const handleSelectAction = useCallback(
    (messageId: string, actionId: string) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || m.role !== "agent") return m;
          // Once committed, the choice is immutable.
          if (m.selectedActionId !== null) return m;
          const action = m.actions.find((a) => a.id === actionId);
          if (!action || !m.decision) return m;
          const outcome = generateActionOutcome(
            action,
            m.decision.caseProgress,
          );
          return {
            ...m,
            selectedActionId: actionId,
            acknowledgement: outcome.acknowledgement,
            decision: { ...m.decision, caseProgress: outcome.nextProgress },
          };
        }),
      );
    },
    [],
  );

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)]">
              <FlaskConical className="h-4 w-4" aria-hidden />
            </span>
            <div className="leading-tight">
              <p className="font-serif text-[18px] font-semibold tracking-tight text-foreground">
                Triage Lab
              </p>
              <p className="text-[12px] text-[var(--text-muted)]">
                Structured decision environment
              </p>
            </div>
          </div>

          <span className="hidden text-[12px] text-[var(--text-muted)] sm:block">
            v0.1 · simulation mode
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-6 pb-8 pt-6">
        <CaseStatusBar
          caseProgress={latestAgent?.decision?.caseProgress ?? 0}
          severity={latestAgent?.decision?.severity ?? null}
          caseCount={userScenarioCount}
        />

        <InputPanel isRunning={isRunning} onSubmit={handleSubmit} />

        <div
          ref={scrollRef}
          className="scroll-area flex-1 space-y-5 overflow-y-auto pr-1"
        >
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.map((message) =>
              message.role === "user" ? (
                <UserMessage key={message.id} message={message} />
              ) : (
                <AgentMessage
                  key={message.id}
                  message={message}
                  onSelectAction={handleSelectAction}
                />
              ),
            )
          )}
        </div>
      </main>
    </div>
  );
}
