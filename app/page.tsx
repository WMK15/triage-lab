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
  AgentMessage as AgentMessageData,
  Decision,
  LiveTaskOption,
  Message,
  Severity,
  ThinkingStep,
} from "@/lib/triage/types";

type EpisodePayload = {
  id: string;
  result: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  trajectory: Array<Record<string, unknown>>;
  rewards: Array<Record<string, unknown>>;
};

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function severityFromScore(score: number): Severity {
  if (score >= 0.95) return "low";
  if (score >= 0.75) return "moderate";
  if (score >= 0.4) return "high";
  return "critical";
}

function sentence(text: string) {
  const trimmed = text.trim();
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

function buildThinking(trajectory: EpisodePayload["trajectory"]): ThinkingStep[] {
  return trajectory.flatMap((event, index) => {
    const type = String(event.type ?? event.kind ?? "");
    if (type === "queued") {
      return [
        {
          id: `queued-${index}`,
          label: "Queued run",
          detail: String(event.text ?? "The backend accepted the run and is waiting for the harness to start."),
        },
      ];
    }
    if (type === "episode_started") {
      return [
        {
          id: `started-${index}`,
          label: "Episode started",
          detail: `Running task ${String(event.task_id ?? "case")} with model ${String(event.model ?? "unknown")}.`,
        },
      ];
    }
    if (type === "prompt_loaded") {
      return [
        {
          id: `prompt-${index}`,
          label: "Prompt loaded",
          detail: "The backend opened the environment session and loaded the case prompt.",
        },
      ];
    }
    if (type === "tools_loaded") {
      return [
        {
          id: `tools-${index}`,
          label: "Tools ready",
          detail: `${String(event.count ?? 0)} tools are available for the model to use.`,
        },
      ];
    }
    if (type === "tool_call") {
      return [
        {
          id: `call-${index}`,
          label: `Calling ${String(event.tool ?? "tool").replaceAll("_", " ")}`,
          detail: typeof event.args === "object" ? JSON.stringify(event.args) : "Preparing tool input.",
        },
      ];
    }
    if (type === "tool_result") {
      return [
        {
          id: `result-${index}`,
          label: `${String(event.tool ?? "tool").replaceAll("_", " ")} result`,
          detail: String(event.text ?? "No output returned."),
        },
      ];
    }
    if (type === "assistant_text") {
      return [
        {
          id: `assistant-${index}`,
          label: "Model response",
          detail: String(event.text ?? "The model replied without a tool call."),
        },
      ];
    }
    if (type === "error") {
      return [
        {
          id: `error-${index}`,
          label: "Backend error",
          detail: String(event.error ?? "Unknown backend error."),
        },
      ];
    }
    return [];
  });
}

function buildPendingThinking(
  episode: EpisodePayload,
  taskLabel: string | undefined,
  scenario: string,
): ThinkingStep[] {
  const realSteps = buildThinking(episode.trajectory);
  if (realSteps.length === 0) {
    const metaStatus = typeof episode.meta?.status === "string" ? episode.meta.status : "starting";
    return [
      {
        id: "starting",
        label: metaStatus === "running" ? "Starting live run" : "Preparing live run",
        detail: taskLabel
          ? `Opening the shift and anchoring on ${taskLabel}.`
          : "Opening the shift and preparing the first patient actions.",
      },
      {
        id: "note",
        label: "Using intake note",
        detail: scenario.trim() || "Waiting for the backend to begin writing trajectory events.",
      },
    ];
  }

  const tail = realSteps.slice(-6);
  return [
    ...tail,
    {
      id: "await-next-step",
      label: "Choosing next action",
      detail: "Latest backend event received. Waiting for the model to pick the next tool call.",
    },
  ];
}

function buildDecision(episode: EpisodePayload): Decision {
  const result = episode.result ?? {};
  const status = typeof result.status === "string" ? result.status : "completed";
  const score =
    typeof result.score === "number"
      ? result.score
      : typeof result.total_reward === "number"
        ? result.total_reward
        : 0;
  const note = typeof result.operator_note === "string" ? result.operator_note : null;
  const task =
    typeof result.task_id === "string"
      ? result.task_id
      : typeof result.task === "string"
        ? result.task
        : episode.id;
  const summary =
    typeof result.summary === "string"
      ? result.summary
      : status === "complete"
        ? `Single-case run completed for ${task}.`
        : `Single-case run stopped with status ${status} for ${task}.`;

  const headline =
    status === "complete"
      ? `Case run complete`
      : status === "max_turns"
        ? `Run stopped at max turns`
        : status === "capped"
          ? `Run stopped by cost cap`
          : `Run status: ${status}`;

  return {
    headline,
    rationale: sentence(note ? `${summary} Operator note: ${note}` : summary),
    severity: severityFromScore(score),
    caseProgress: Math.round(score * 100),
  };
}

function buildActions(episode: EpisodePayload): Action[] {
  const result = episode.result ?? {};
  const task =
    typeof result.task_id === "string"
      ? result.task_id
      : typeof result.task === "string"
        ? result.task
        : episode.id;
  const status = typeof result.status === "string" ? result.status : "complete";

  return [
    {
      id: `${episode.id}-episode`,
      label: "Review episode log",
      description: `Inspect ${task} in the episodes archive.`,
      intent: "default",
    },
    {
      id: `${episode.id}-rerun`,
      label: status === "complete" ? "Run adjacent case" : "Retry case run",
      description:
        status === "complete"
          ? `Case run completed cleanly; compare against another dataset-matched case.`
          : `This run ended as ${status}; retry ${task} with a tighter note or fewer ambiguities.`,
      intent: "constructive",
    },
    {
      id: `${episode.id}-handoff`,
      label: `Inspect ${status} result`,
      description: `Open the detailed episode view to inspect the case trajectory and tool trace.`,
      intent: status === "capped" ? "escalation" : "default",
    },
  ];
}

function buildAcknowledgement(episode: EpisodePayload): string | null {
  const result = episode.result ?? {};
  const status = typeof result.status === "string" ? result.status : null;
  return status ? `Live case run finished with status ${status}.` : null;
}

function messageFromEpisode(messageId: string, episode: EpisodePayload): AgentMessageData {
  return {
    id: messageId,
    role: "agent",
    status: "ready",
    thinking: buildThinking(episode.trajectory),
    decision: buildDecision(episode),
    actions: buildActions(episode),
    selectedActionId: episode.id ? `${episode.id}-episode` : null,
    acknowledgement: buildAcknowledgement(episode),
    createdAt: Date.now(),
  };
}

export default function TriageLabPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [tasks, setTasks] = useState<LiveTaskOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
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
    async (scenario: string, taskId: string) => {
      const task = tasks.find((item) => item.id === taskId) ?? null;
      const userId = makeId();
      const agentId = makeId();
      const now = Date.now();
      setMessages((prev) => [
        ...prev,
        {
          id: userId,
          role: "user",
          scenario,
          environment: "clinical",
          taskId,
          taskLabel: task?.label,
          createdAt: now,
        },
        {
          id: agentId,
          role: "agent",
          status: "thinking",
          thinking: [
            {
              id: "starting",
              label: "Starting live run",
              detail: task?.label
                ? `Opening the shift and anchoring on ${task.label}.`
                : "Opening the shift and preparing the first patient actions.",
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

      try {
        const runResponse = await fetch("/api/triage/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, note: scenario }),
        });
        const runPayload = (await runResponse.json()) as { episodeId?: string; error?: string };
        if (!runResponse.ok || !runPayload.episodeId) {
          throw new Error(runPayload.error ?? "failed to launch live case");
        }

        let complete = false;
        for (let attempt = 0; attempt < 120; attempt += 1) {
          const episodeResponse = await fetch(`/api/episodes/${runPayload.episodeId}`, {
            cache: "no-store",
          });
          const episodePayload = (await episodeResponse.json()) as EpisodePayload & { error?: string };
          if (!episodeResponse.ok) {
            throw new Error(episodePayload.error ?? "failed to load live episode");
          }

          if (episodePayload.result) {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === agentId && message.role === "agent"
                  ? messageFromEpisode(agentId, episodePayload)
                  : message,
              ),
            );
            complete = true;
            break;
          }

          setMessages((prev) =>
            prev.map((message) =>
              message.id === agentId && message.role === "agent"
                ? {
                    ...message,
                    status: "thinking",
                    thinking: buildPendingThinking(episodePayload, task?.label, scenario),
                  }
                : message,
            ),
          );

          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }

        if (!complete) {
          throw new Error("live run timed out before the episode finished writing its result");
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
                    headline: "Live case failed",
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
    [tasks],
  );

  const handleSelectAction = useCallback((messageId: string, actionId: string) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId || message.role !== "agent") return message;
        if (message.selectedActionId !== null) return message;
        return {
          ...message,
          selectedActionId: actionId,
          acknowledgement: "Action selection is local-only in the live baseline UI.",
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
                Live triage-nurse baseline runner
              </p>
            </div>
          </div>

          <span className="hidden text-[12px] text-[var(--text-muted)] sm:block">
            v0.2 · live mode
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-6 pb-8 pt-6">
        <CaseStatusBar
          caseProgress={latestAgent?.decision?.caseProgress ?? 0}
          severity={latestAgent?.decision?.severity ?? null}
          caseCount={userScenarioCount}
        />

        <InputPanel isRunning={isRunning} tasks={tasks} onSubmit={handleSubmit} />

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
