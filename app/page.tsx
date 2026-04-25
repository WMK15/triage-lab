"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical } from "lucide-react";

import { AgentMessage } from "@/components/triage/agent-message";
import { CaseStatusBar } from "@/components/triage/case-status-bar";
import { EmptyState } from "@/components/triage/empty-state";
import { InputPanel } from "@/components/triage/input-panel";
import { UserMessage } from "@/components/triage/user-message";
import type {
  AgentMessage as AgentMessageData,
  AssessResponse,
  ChatAssessRequest,
  Decision,
  EvaluationAssignment,
  EvaluationDetails,
  EvaluationSummary,
  LiveTaskOption,
  Message,
  RunRequest,
  Severity,
  ThinkingStep,
  TriageClassification,
} from "@/lib/triage/types";

type EpisodePayload = {
  id: string;
  result: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  trajectory: Array<Record<string, unknown>>;
  rewards: Array<Record<string, unknown>>;
};

const META_DELIMITER = "\n--META--\n";

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
  return trajectory
    .filter((event) => event.kind === "tool_result")
    .map((event, index) => ({
      id: `${String(event.tool ?? "step")}-${index}`,
      label: String(event.tool ?? "step").replaceAll("_", " "),
      detail: String(event.text ?? "No output returned.").split(META_DELIMITER, 1)[0].trim(),
    }));
}

function parseNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseEvaluation(episode: EpisodePayload): EvaluationDetails | null {
  const result = episode.result ?? {};
  const assignments = Array.isArray(result.per_patient_assignments)
    ? (result.per_patient_assignments as EvaluationAssignment[])
    : [];
  if (assignments.length === 0) return null;

  return {
    compositeScore: parseNumber(result.composite_score),
    baseReward: parseNumber(result.base_reward),
    orderingBonus: parseNumber(result.ordering_bonus),
    scoredCount: typeof result.scored_count === "number" ? result.scored_count : 0,
    manualCount: typeof result.manual_count === "number" ? result.manual_count : 0,
    assignments,
    summary: (result.evaluation_summary as EvaluationSummary | null) ?? null,
  };
}

function buildLoadingThinkingSteps(
  taskLabel: string | undefined,
  scenario: string,
): ThinkingStep[] {
  const notePreview = scenario.trim().slice(0, 96);
  return [
    {
      id: "loading-match",
      label: "Matching intake",
      detail: taskLabel
        ? `Anchoring the live shift around ${taskLabel}.`
        : "Linking the intake note to the closest live case.",
    },
    {
      id: "loading-env",
      label: "Preparing environment",
      detail: "Connecting to the OpenReward triage environment and opening a session.",
    },
    {
      id: "loading-plan",
      label: "Planning first actions",
      detail: notePreview
        ? `Using the operator note as context: ${notePreview}${scenario.trim().length > 96 ? "..." : ""}`
        : "Reviewing the note and planning the first chart actions.",
    },
    {
      id: "loading-tools",
      label: "Running tool loop",
      detail: "The agent is reading the chart, reviewing patients, and choosing next tools.",
    },
    {
      id: "loading-score",
      label: "Scoring episode",
      detail: "Waiting for the backend to finish the shift and write the final episode files.",
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
      : `Shift run ${status} for ${task}.`;

  return {
    headline: `Shift status: ${status}`,
    rationale: sentence(note ? `${summary} Operator note: ${note}` : summary),
    severity: severityFromScore(score),
    ktasLevel: null,
    caseProgress: Math.round(score * 100),
  };
}

function buildAcknowledgement(episode: EpisodePayload): string | null {
  const result = episode.result ?? {};
  const summary = typeof result.summary === "string" ? result.summary : null;
  if (summary) return summary;
  const status = typeof result.status === "string" ? result.status : null;
  return status ? `The triage run finished with status ${status}.` : null;
}

function asKtasLevel(value: unknown): TriageClassification["agentLevel"] | null {
  return typeof value === "number" && value >= 1 && value <= 5
    ? (value as TriageClassification["agentLevel"])
    : null;
}

function buildTriageClassifications(
  result: EpisodePayload["result"],
): TriageClassification[] {
  const rows = result?.per_patient_assignments;
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const data = row as Record<string, unknown>;
    const agentLevel = asKtasLevel(data.agent_level);
    if (agentLevel == null) return [];

    return [
      {
        patientId:
          typeof data.patient_id === "string" ? data.patient_id : "unknown",
        chiefComplaint:
          typeof data.chief_complaint === "string"
            ? data.chief_complaint
            : undefined,
        source: data.source === "manual" ? "manual" : "dataset",
        agentLevel,
        truthLevel: asKtasLevel(data.truth_level),
        reward: typeof data.reward === "number" ? data.reward : null,
        scored: data.scored === true,
        order: typeof data.order === "number" ? data.order : undefined,
      },
    ];
  });
}

function messageFromEpisode(messageId: string, episode: EpisodePayload): AgentMessageData {
  return {
    id: messageId,
    role: "agent",
    status: "ready",
    thinking: buildThinking(episode.trajectory),
    decision: buildDecision(episode),
    triageClassifications: buildTriageClassifications(episode.result),
    evaluation: parseEvaluation(episode),
    acknowledgement: buildAcknowledgement(episode),
    createdAt: Date.now(),
  };
}

function intakePrompt(assessment: Extract<AssessResponse, { kind: "question" }>): Decision {
  return {
    headline: "More information needed",
    rationale: sentence(`${assessment.summary} ${assessment.question}`),
    severity: "moderate",
    ktasLevel: null,
    caseProgress: 35,
  };
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

function isChatRequest(request: RunRequest | ChatAssessRequest): request is ChatAssessRequest {
  return request.mode === "chat";
}

export default function TriageLabPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [tasks, setTasks] = useState<LiveTaskOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [followUpQuestion, setFollowUpQuestion] = useState<string | null>(null);
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
    async (request: RunRequest | ChatAssessRequest) => {
      const userId = makeId();
      const agentId = makeId();
      const now = Date.now();

      if (isChatRequest(request)) {
        const scenario = request.text;
        const nextHistory = [...history, scenario];

        setMessages((prev) => [
          ...prev,
          {
            id: userId,
            role: "user",
            scenario,
            environment: "clinical",
            taskLabel: "Chat triage",
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
            evaluation: null,
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
            body: JSON.stringify({ history: nextHistory }),
          });
          const assessPayload = (await assessResponse.json()) as AssessResponse & {
            error?: string;
          };
          if (!assessResponse.ok) {
            throw new Error(assessPayload.error ?? "failed to assess intake");
          }

          const matchedTaskLabel = assessPayload.matchedCase?.caseLabel ?? null;

          if (assessPayload.kind === "question") {
            setFollowUpQuestion(assessPayload.question);
            setMessages((prev) =>
              prev.map((message) =>
                message.id === agentId && message.role === "agent"
                  ? {
                      ...message,
                      status: "ready",
                      thinking: [
                        ...assessPayload.thinking,
                        backgroundThinking(matchedTaskLabel),
                      ],
                      decision: intakePrompt(assessPayload),
                      evaluation: null,
                      acknowledgement: "Reply in the composer below so the case can be triaged.",
                    }
                  : message,
              ),
            );
          } else {
            setFollowUpQuestion(null);
            setMessages((prev) =>
              prev.map((message) =>
                message.id === agentId && message.role === "agent"
                  ? {
                      ...message,
                      status: "ready",
                      thinking: [
                        ...assessPayload.thinking,
                        backgroundThinking(matchedTaskLabel),
                      ],
                      decision: assessPayload.decision,
                      evaluation: null,
                      acknowledgement: assessPayload.acknowledgement,
                    }
                  : message,
              ),
            );
          }

          if (assessPayload.matchedCase?.taskId) {
            void fetch("/api/triage/run", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode: "test",
                taskId: assessPayload.matchedCase.taskId,
                batchSize: 5,
                extraPatient: nextHistory.join("\n"),
              }),
            }).catch(() => undefined);
          }

          if (assessPayload.kind === "decision") {
            setHistory([]);
          }
        } catch (error) {
          setFollowUpQuestion(null);
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
                      ktasLevel: null,
                      caseProgress: 0,
                    },
                    evaluation: null,
                    acknowledgement: "The assessment could not be completed. Try again after the backend recovers.",
                  }
                : message,
            ),
          );
        } finally {
          setIsRunning(false);
        }

        return;
      }

      const scenario =
        request.mode === "test"
          ? `Test batch ${request.taskId} (${request.batchSize} patient${request.batchSize === 1 ? "" : "s"})${request.savedResponses ? " - saved response" : ""}${request.extraPatient ? ` + intake-note patient: \"${request.extraPatient}\"` : ""}`
          : request.mode === "manual-single"
            ? request.patient.chiefComplaint
            : request.patients.map((p, i) => `${i + 1}. ${p.chiefComplaint}`).join("\n");
      const taskLabel =
        request.mode === "test"
          ? tasks.find((t) => t.id === request.taskId)?.label
          : request.mode === "manual-single"
            ? "Manual single"
            : `Manual multi (${request.patients.length})`;
      const loadingSteps = buildLoadingThinkingSteps(taskLabel, scenario);
      const savedResponses = request.mode === "test" && request.savedResponses;
      const loadingStepMs = savedResponses ? 700 : 1600;
      const minimumRunMs = savedResponses
        ? loadingStepMs * (loadingSteps.length - 1) + 250
        : 0;

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
          thinking: [loadingSteps[0]],
          decision: null,
          evaluation: null,
          acknowledgement: null,
          createdAt: now,
        },
      ]);
      setIsRunning(true);

      let loadingIndex = 0;
      const loadingTimer = window.setInterval(() => {
        loadingIndex = Math.min(loadingIndex + 1, loadingSteps.length - 1);
        setMessages((prev) =>
          prev.map((message) =>
            message.id === agentId && message.role === "agent" && message.status === "thinking"
              ? {
                  ...message,
                  thinking: loadingSteps.slice(0, loadingIndex + 1),
                }
              : message,
          ),
        );
      }, loadingStepMs);

      try {
        const startedAt = Date.now();
        const runResponse = await fetch("/api/triage/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const runPayload = (await runResponse.json()) as { episodeId?: string; error?: string };
        if (!runResponse.ok || !runPayload.episodeId) {
          throw new Error(runPayload.error ?? "failed to launch live case");
        }

        const episodeResponse = await fetch(`/api/episodes/${runPayload.episodeId}`, {
          cache: "no-store",
        });
        const episodePayload = (await episodeResponse.json()) as EpisodePayload & {
          error?: string;
        };
        if (!episodeResponse.ok) {
          throw new Error(episodePayload.error ?? "failed to load live episode");
        }

        const elapsedMs = Date.now() - startedAt;
        if (minimumRunMs > elapsedMs) {
          await wait(minimumRunMs - elapsedMs);
        }

        setMessages((prev) =>
          prev.map((message) =>
            message.id === agentId && message.role === "agent"
              ? messageFromEpisode(agentId, episodePayload)
              : message,
          ),
        );
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
                    ktasLevel: null,
                    caseProgress: 0,
                  },
                  evaluation: null,
                  acknowledgement: "The live case could not be completed because the backend run failed.",
                }
              : message,
          ),
        );
      } finally {
        window.clearInterval(loadingTimer);
        setIsRunning(false);
      }
    },
    [history, tasks],
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
                Multi-mode triage console
              </p>
            </div>
          </div>

          <span className="hidden text-[12px] text-[var(--text-muted)] sm:block">
            v0.3 · batch + chat
          </span>
        </div>
      </header>

      <main className="mx-auto flex h-[calc(100svh-73px)] w-full max-w-3xl flex-1 flex-col gap-5 overflow-hidden px-6 pb-4 pt-6">
        <CaseStatusBar
          caseProgress={latestAgent?.decision?.caseProgress ?? 0}
          severity={latestAgent?.decision?.severity ?? null}
          caseCount={userScenarioCount}
        />

        {loadError ? (
          <div className="rounded-2xl border border-[var(--error-border)] bg-[var(--error-bg)] px-4 py-3 text-[13px] text-[var(--error-text)] shadow-sm">
            Could not load live cases: {loadError}
          </div>
        ) : null}

        <div ref={scrollRef} className="scroll-area min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.map((message) =>
              message.role === "user" ? (
                <UserMessage key={message.id} message={message} />
              ) : (
                <AgentMessage key={message.id} message={message} />
              ),
            )
          )}
        </div>

        <div className="sticky bottom-0 z-10 -mx-2 bg-background/95 px-2 pb-1 pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <InputPanel
            isRunning={isRunning}
            tasks={tasks}
            onSubmit={handleSubmit}
            followUpQuestion={followUpQuestion}
          />
        </div>
      </main>
    </div>
  );
}
