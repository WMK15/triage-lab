import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";

const RUNS_DIR = path.join(process.cwd(), "triage-nurse", "runs");

type Params = Promise<{ id: string }>;

type Result = {
  episode_id: string;
  task_id: string;
  model: string;
  turns: number;
  finished: boolean;
  status: string;
  total_reward: number;
  cost_usd: number;
  cost_gbp: number;
  calls: number;
  by_model: Record<string, { calls: number; input: number; output: number; usd: number }>;
  started_at: string;
  ended_at: string;
  max_turns: number;
};

type TrajectoryEvent =
  | { turn: number; type: "tool_call"; tool: string; args: Record<string, unknown>; ts: string }
  | { turn: number; type: "tool_result"; tool: string; text: string; reward: number; finished: boolean; ts: string }
  | { turn: number; type: "assistant_text"; text: string; ts: string }
  | { turn: number; type: "error"; error: string; ts: string };

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
  if (evt.type === "tool_call") {
    const argsPreview = JSON.stringify(evt.args);
    return `${evt.tool}(${argsPreview.length > 80 ? argsPreview.slice(0, 80) + "…" : argsPreview})`;
  }
  if (evt.type === "tool_result") {
    const text = evt.text.length > 120 ? evt.text.slice(0, 120) + "…" : evt.text;
    const fin = evt.finished ? " · finished" : "";
    return `→ reward=${evt.reward}${fin} · ${text}`;
  }
  if (evt.type === "assistant_text") {
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
                  <span className="text-[var(--text-muted)]">{evt.type}</span>{" "}
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
