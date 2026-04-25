import Link from "next/link";

import { FlaskConical } from "lucide-react";

import { listEpisodes } from "@/lib/triage/runtime";

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
                      {episode.task ? (
                        <p className="mt-1 text-[13px] text-foreground">{episode.task}</p>
                      ) : null}
                      <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                        {new Date(episode.modifiedAt).toLocaleString()}
                      </p>
                      {episode.summary ? (
                        <p className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
                          {episode.summary}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[12px] text-[var(--text-muted)]">
                        {episode.trajectoryEvents} events
                      </span>
                      {episode.score !== null ? (
                        <span className="font-mono text-[12px] text-[var(--text-secondary)]">
                          {Math.round(episode.score * 100)}%
                        </span>
                      ) : null}
                      {episode.disposition ? (
                        <span className="text-[12px] text-[var(--text-secondary)]">
                          {episode.disposition}
                        </span>
                      ) : null}
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
