"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical } from "lucide-react";

import { AgentMessage } from "@/components/triage/agent-message";
import { CaseStatusBar } from "@/components/triage/case-status-bar";
import { EmptyState } from "@/components/triage/empty-state";
import { InputPanel } from "@/components/triage/input-panel";
import { UserMessage } from "@/components/triage/user-message";
import type {
  Action,
  AssessResponse,
  Decision,
  LiveTaskOption,
  Message,
  RunRequest,
  Severity,
  ThinkingStep,
} from "@/lib/triage/types";

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function sentence(text: string) {
  const trimmed = text.trim();
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

function intakePrompt(assessment: Extract<AssessResponse, { kind: "question" }>): Decision {
  return {
    headline: "More information needed",
    rationale: sentence(`${assessment.summary} ${assessment.question}`),
    severity: "moderate",
    caseProgress: 35,
  };
}

function intakeActions(): Action[] {
  return [
    {
      id: "answer-follow-up",
      label: "Answer follow-up",
      description: "Reply with the missing detail so the case can be triaged.",
      intent: "constructive",
    },
  ];
}

function backgroundThinking(taskLabel: string | null): ThinkingStep {
  return {
    id: "benchmark",
    label: "Background benchmark",
    detail: taskLabel
      ? `Queued hidden evaluation against ${taskLabel}.`
      : "Queued hidden evaluation against the closest dataset match.",
  };
}

export default function TriageLabPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [tasks, setTasks] = useState<LiveTaskOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;

    async function loadTasks() {
      try {
        const response = await fetch("/api/triage/tasks", { cache: "no-store" });
        if (!response.ok) throw new Error("failed to load live cases");
        const payload = (await response.json()) as { tasks: LiveTaskOption[] };
        if (!cancelled) {
          setTasks(payload.tasks);
          setLoadError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "failed to load live cases");
        }
      }
    }

    void loadTasks();
    return () => {
      cancelled = true;
    };
  }, []);

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
    async (request: RunRequest) => {
      const userId = makeId();
      const agentId = makeId();
      const now = Date.now();

      // Synthesize a user-facing description of what's being run for the
      // chat bubble + loading thinking steps.
      let scenario = "";
      let taskLabel: string | undefined;
      if (request.mode === "test") {
        const task = tasks.find((t) => t.id === request.taskId) ?? null;
        taskLabel = task?.label;
        scenario =
          `Test batch ${request.taskId} (${request.batchSize} patient${
            request.batchSize === 1 ? "" : "s"
          })` +
          (request.extraPatient
            ? ` + intake-note patient: "${request.extraPatient}"`
            : "");
      } else if (request.mode === "manual-single") {
        taskLabel = "Manual single";
        scenario = request.patient.chiefComplaint;
      } else {
        taskLabel = `Manual multi (${request.patients.length})`;
        scenario = request.patients
          .map((p, i) => `${i + 1}. ${p.chiefComplaint}`)
          .join("\n");
      }
      const loadingSteps = buildLoadingThinkingSteps(taskLabel, scenario);

      setMessages((prev) => [
        ...prev,
        {
          id: userId,
          role: "user",
          scenario,
          environment: "clinical",
          taskId: request.mode === "test" ? request.taskId : undefined,
          taskLabel,
          createdAt: now,
        },
        {
          id: agentId,
          role: "agent",
          status: "thinking",
          thinking: [
            {
              id: "starting",
              label: "Reviewing intake",
              detail:
                history.length === 0
                  ? "Reading the initial complaint and checking whether follow-up is needed."
                  : "Updating the assessment with the latest follow-up answer.",
            },
          ],
          decision: null,
          actions: [],
          selectedActionId: null,
          acknowledgement: null,
          createdAt: now,
        },
      ]);
      setIsRunning(true);
      setHistory(nextHistory);

      try {
        const assessResponse = await fetch("/api/triage/assess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const assessPayload = (await assessResponse.json()) as AssessResponse & { error?: string };
        if (!assessResponse.ok) {
          throw new Error(assessPayload.error ?? "failed to assess intake");
        }

        const matchedTask = assessPayload.matchedCase
          ? tasks.find((item) => item.id === assessPayload.matchedCase?.taskId) ?? null
          : null;

        if (assessPayload.kind === "question") {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === agentId && message.role === "agent"
                ? {
                    ...message,
                    status: "ready",
                    thinking: [
                      ...assessPayload.thinking,
                      backgroundThinking(matchedTask?.label ?? null),
                    ],
                    decision: intakePrompt(assessPayload),
                    actions: intakeActions(),
                    selectedActionId: null,
                    acknowledgement: null,
                  }
                : message,
            ),
          );
        } else {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === agentId && message.role === "agent"
                ? {
                    ...message,
                    status: "ready",
                    thinking: [
                      ...assessPayload.thinking,
                      backgroundThinking(matchedTask?.label ?? null),
                    ],
                    decision: assessPayload.decision,
                    actions: assessPayload.actions,
                    selectedActionId: null,
                    acknowledgement: assessPayload.acknowledgement,
                  }
                : message,
            ),
          );
        }

        if (matchedTask) {
          void fetch("/api/triage/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskId: matchedTask.id, note: nextHistory.join("\n") }),
          }).catch(() => undefined);
        }

        if (assessPayload.kind === "decision") {
          setHistory([]);
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : "live run failed";
        setMessages((prev) =>
          prev.map((message) =>
            message.id === agentId && message.role === "agent"
              ? {
                  ...message,
                  status: "ready",
                  thinking: [
                    {
                      id: "backend-error",
                      label: "Backend failure",
                      detail: text,
                    },
                  ],
                  decision: {
                    headline: "Assessment failed",
                    rationale: sentence(text),
                    severity: "high",
                    caseProgress: 0,
                  },
                  actions: [],
                  selectedActionId: null,
                  acknowledgement: null,
                }
              : message,
          ),
        );
      } finally {
        setIsRunning(false);
      }
    },
    [history, tasks],
  );

  const handleSelectAction = useCallback((messageId: string, actionId: string) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId || message.role !== "agent") return message;
        if (message.selectedActionId !== null) return message;
        return {
          ...message,
          selectedActionId: actionId,
          acknowledgement:
            message.actions.find((action) => action.id === actionId)?.label ===
            "Answer follow-up"
              ? "Add the requested follow-up detail in the input panel to continue triage."
              : "Action selection is local-only in the current triage UI.",
        };
      }),
    );
  }, []);

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
                Intake-driven emergency triage console
              </p>
            </div>
          </div>

          <span className="hidden text-[12px] text-[var(--text-muted)] sm:block">
            v0.2 · intake mode
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-6 pb-8 pt-6">
        <CaseStatusBar
          caseProgress={latestAgent?.decision?.caseProgress ?? 0}
          severity={latestAgent?.decision?.severity ?? null}
          caseCount={userScenarioCount}
        />

        <InputPanel
          isRunning={isRunning}
          tasks={tasks}
          onSubmit={handleSubmit}
          submitLabel={history.length === 0 ? "Assess case" : "Submit follow-up"}
        />

        {loadError ? (
          <div className="rounded-2xl border border-[var(--error-border)] bg-[var(--error-bg)] px-4 py-3 text-[13px] text-[var(--error-text)] shadow-sm">
            Could not load live cases: {loadError}
          </div>
        ) : null}

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
