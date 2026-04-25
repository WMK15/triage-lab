import fs from "node:fs";
import path from "node:path";
import Link from "next/link";

import { FlaskConical } from "lucide-react";

const RUNS_DIR = path.join(process.cwd(), "triage-nurse", "runs");

type EpisodeRow = {
  id: string;
  modifiedAt: number;
  hasResult: boolean;
  trajectoryEvents: number;
};

function listEpisodes(): EpisodeRow[] {
  if (!fs.existsSync(RUNS_DIR)) return [];
  const entries = fs.readdirSync(RUNS_DIR, { withFileTypes: true });
  const rows: EpisodeRow[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(RUNS_DIR, entry.name);
    const stat = fs.statSync(dir);
    const trajPath = path.join(dir, "trajectory.jsonl");
    let trajectoryEvents = 0;
    if (fs.existsSync(trajPath)) {
      const raw = fs.readFileSync(trajPath, "utf-8");
      trajectoryEvents = raw.split("\n").filter((line) => line.length > 0).length;
    }
    rows.push({
      id: entry.name,
      modifiedAt: stat.mtimeMs,
      hasResult: fs.existsSync(path.join(dir, "result.json")),
      trajectoryEvents,
    });
  }
  return rows.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export default function EpisodesIndexPage() {
  const episodes = listEpisodes();

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
                Triage Lab — Episodes
              </p>
              <p className="text-[12px] text-[var(--text-muted)]">
                Past harness rollouts
              </p>
            </div>
          </div>

          <Link
            href="/"
            className="text-[13px] text-[var(--text-muted)] hover:text-foreground"
          >
            ← Back to lab
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-6 pb-8 pt-6">
        {episodes.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
            <p className="text-[14px] text-foreground">No episodes yet.</p>
            <p className="mt-1 text-[12px] text-[var(--text-muted)]">
              Run{" "}
              <code className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 font-mono text-[12px]">
                just run-harness
              </code>{" "}
              inside{" "}
              <code className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 font-mono text-[12px]">
                triage-nurse/
              </code>{" "}
              to produce one. Rollouts land in{" "}
              <code className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 font-mono text-[12px]">
                triage-nurse/runs/&lt;episode_id&gt;/
              </code>
              .
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {episodes.map((episode) => (
              <li key={episode.id}>
                <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[13px] text-foreground">
                        {episode.id}
                      </p>
                      <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                        {new Date(episode.modifiedAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[12px] text-[var(--text-muted)]">
                        {episode.trajectoryEvents} events
                      </span>
                      {episode.hasResult ? (
                        <span className="text-[12px] text-[var(--decision-text)]">
                          scored
                        </span>
                      ) : (
                        <span className="text-[12px] text-[var(--text-muted)]">
                          unscored
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
