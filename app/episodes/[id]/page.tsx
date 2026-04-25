import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatKtasLabel } from "@/lib/triage/ktas";

const RUNS_DIR = path.join(process.cwd(), "triage-nurse", "runs");

type Params = Promise<{ id: string }>;

type PerPatient = {
  patient_id: string;
  agent_level: number;
  truth_level: number | null;
  reward: number | null;
  order: number;
  scored: boolean;
  source: "dataset" | "manual";
  chief_complaint?: string;
};

type EvalSummary = {
  scored_count: number;
  exact_matches: number;
  over_triage: number;
  under_triage: number;
  exact_rate: number;
  mistriage_rate: number;
  under_triage_rate: number;
  off_by_one_count: number;
  off_by_two_or_more_count: number;
  confusion: Record<string, Record<string, number>>;
};

type Result = {
  episode_id: string;
  task_id: string;
  model: string;
  turns: number;
  finished: boolean;
  status: string;
  total_reward: number;
  composite_score?: number | null;
  score?: number | null;
  summary?: string | null;
  cost_usd: number;
  cost_gbp: number;
  calls: number;
  by_model: Record<string, { calls: number; input: number; output: number; usd: number }>;
  started_at: string;
  ended_at: string;
  max_turns: number;
  scored_count?: number | null;
  manual_count?: number | null;
  per_patient_assignments?: PerPatient[] | null;
  evaluation_summary?: EvalSummary | null;
};

type TrajectoryEvent =
  | { turn: number; kind: "tool_call"; tool: string; args: Record<string, unknown>; ts: string }
  | { turn: number; kind: "tool_result"; tool: string; text: string; reward: number; finished: boolean; ts: string }
  | { turn: number; kind: "assistant_text"; text: string; ts: string }
  | { turn: number; kind: "error"; error: string; ts: string };

function readEpisode(id: string): { result: Result | null; trajectory: TrajectoryEvent[] } | null {
  const dir = path.join(RUNS_DIR, id);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const resultPath = path.join(dir, "result.json");
  const trajPath = path.join(dir, "trajectory.jsonl");
  const result: Result | null = fs.existsSync(resultPath)
    ? JSON.parse(fs.readFileSync(resultPath, "utf-8"))
    : null;
  const trajectory: TrajectoryEvent[] = fs.existsSync(trajPath)
    ? fs
        .readFileSync(trajPath, "utf-8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as TrajectoryEvent)
    : [];
  return { result, trajectory };
}

function summariseEvent(evt: TrajectoryEvent): string {
  if (evt.kind === "tool_call") {
    const argsPreview = JSON.stringify(evt.args);
    return `${evt.tool}(${argsPreview.length > 80 ? argsPreview.slice(0, 80) + "…" : argsPreview})`;
  }
  if (evt.kind === "tool_result") {
    const text = evt.text.length > 120 ? evt.text.slice(0, 120) + "…" : evt.text;
    const fin = evt.finished ? " · finished" : "";
    return `→ reward=${evt.reward}${fin} · ${text}`;
  }
  if (evt.kind === "assistant_text") {
    return `(text only) ${evt.text.slice(0, 120)}`;
  }
  return `error: ${evt.error}`;
}

const MAX_EVENTS_DISPLAYED = 200;

export default async function EpisodePage({ params }: { params: Params }) {
  const { id } = await params;
  const data = readEpisode(id);
  if (!data) notFound();
  const { result, trajectory } = data;
  const visible = trajectory.slice(0, MAX_EVENTS_DISPLAYED);
  const truncated = trajectory.length - visible.length;

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="leading-tight">
            <p className="font-serif text-[18px] font-semibold tracking-tight text-foreground">
              Episode <span className="font-mono text-[14px]">{id}</span>
            </p>
            <p className="text-[12px] text-[var(--text-muted)]">
              {trajectory.length} events
              {result ? ` · ${result.model} · ${result.status}` : ""}
            </p>
          </div>
          <Link
            href="/episodes"
            className="text-[13px] text-[var(--text-muted)] hover:text-foreground"
          >
            ← All episodes
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-6 pb-8 pt-6">
        {result ? (
          <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Result
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-[var(--text-muted)]">Task</dt>
              <dd className="font-mono">{result.task_id}</dd>
              <dt className="text-[var(--text-muted)]">Model</dt>
              <dd className="font-mono">{result.model}</dd>
              <dt className="text-[var(--text-muted)]">Status</dt>
              <dd className="font-mono">{result.status}</dd>
              <dt className="text-[var(--text-muted)]">Turns</dt>
              <dd className="font-mono">
                {result.turns} / {result.max_turns}
              </dd>
              <dt className="text-[var(--text-muted)]">Total reward</dt>
              <dd className="font-mono">{result.total_reward.toFixed(3)}</dd>
              <dt className="text-[var(--text-muted)]">Cost</dt>
              <dd className="font-mono">
                £{result.cost_gbp.toFixed(4)} (${result.cost_usd.toFixed(4)})
              </dd>
              <dt className="text-[var(--text-muted)]">Composite</dt>
              <dd className="font-mono">
                {result.composite_score != null
                  ? result.composite_score.toFixed(3)
                  : "(none — pure manual run)"}
              </dd>
              <dt className="text-[var(--text-muted)]">Started</dt>
              <dd className="font-mono">{new Date(result.started_at).toLocaleString()}</dd>
              <dt className="text-[var(--text-muted)]">Ended</dt>
              <dd className="font-mono">{new Date(result.ended_at).toLocaleString()}</dd>
            </dl>
          </section>
        ) : (
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <p className="text-[13px] text-[var(--text-muted)]">
              No <code>result.json</code> found — episode may have been killed before
              writing the summary.
            </p>
          </div>
        )}

        {result?.per_patient_assignments && result.per_patient_assignments.length > 0 ? (
          <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Evaluation
            </h2>
            {result.evaluation_summary ? (
              <p className="mt-2 text-[12px] text-[var(--text-secondary)]">
                Scored {result.scored_count} / {result.per_patient_assignments.length}
                {" · "}exact {result.evaluation_summary.exact_matches}/
                {result.evaluation_summary.scored_count} (
                {(result.evaluation_summary.exact_rate * 100).toFixed(1)}%)
                {" · "}mistriage{" "}
                {(result.evaluation_summary.mistriage_rate * 100).toFixed(1)}%
                {" · "}over {result.evaluation_summary.over_triage}
                {" · "}under {result.evaluation_summary.under_triage}
              </p>
            ) : null}
            <table className="mt-3 w-full text-[12px]">
              <thead>
                <tr className="text-left text-[var(--text-muted)]">
                  <th className="py-1 pr-2 font-medium">Patient</th>
                  <th className="py-1 pr-2 font-medium">Source</th>
                  <th className="py-1 pr-2 font-medium">Truth</th>
                  <th className="py-1 pr-2 font-medium">Agent</th>
                  <th className="py-1 pr-2 font-medium">Δ</th>
                  <th className="py-1 pr-2 font-medium">Reward</th>
                </tr>
              </thead>
              <tbody>
                {result.per_patient_assignments.map((a) => {
                  const delta =
                    a.truth_level != null
                      ? a.agent_level === a.truth_level
                        ? "exact"
                        : a.agent_level < a.truth_level
                          ? `+${a.truth_level - a.agent_level} over`
                          : `−${a.agent_level - a.truth_level} UNDER`
                      : "—";
                  return (
                    <tr key={a.patient_id} className="border-t border-border">
                      <td className="py-1 pr-2 font-mono">{a.patient_id}</td>
                      <td className="py-1 pr-2 text-[var(--text-muted)]">
                        {a.source}
                        {a.scored ? "" : " · unscored"}
                      </td>
                        <td className="py-1 pr-2 font-mono">
                          {a.truth_level != null
                          ? `${a.truth_level} (${formatKtasLabel(a.truth_level)})`
                          : "—"}
                        </td>
                        <td className="py-1 pr-2 font-mono">
                        {a.agent_level} ({formatKtasLabel(a.agent_level)})
                        </td>
                      <td className="py-1 pr-2 font-mono">{delta}</td>
                      <td className="py-1 pr-2 font-mono">
                        {a.reward != null ? a.reward.toFixed(2) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {result.evaluation_summary ? (
              <p className="mt-3 text-[11px] italic text-[var(--text-muted)]">
                Vs. nurse panel on this dataset (Moon et al. 2019): mistriage
                rate 14.7%, of which 70.4% were under-triage.
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Trajectory
          </h2>
          {visible.length === 0 ? (
            <p className="mt-3 text-[12px] text-[var(--text-muted)]">
              No <code>trajectory.jsonl</code> in this episode directory.
            </p>
          ) : (
            <ol className="mt-3 space-y-1.5">
              {visible.map((evt, i) => (
                <li
                  key={i}
                  className="rounded-lg bg-[var(--surface-secondary)] px-3 py-1.5 font-mono text-[11px] text-foreground"
                >
                  <span className="text-[var(--text-muted)]">
                    #{evt.turn.toString().padStart(3, "0")}
                  </span>{" "}
                  <span className="text-[var(--text-muted)]">{evt.kind}</span>{" "}
                  {summariseEvent(evt)}
                </li>
              ))}
              {truncated > 0 && (
                <li className="px-3 py-1.5 text-[12px] text-[var(--text-muted)]">
                  …and {truncated} more events.
                </li>
              )}
            </ol>
          )}
        </section>
      </main>
    </div>
  );
}
