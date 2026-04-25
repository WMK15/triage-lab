"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { IntakeSuggestion, LiveTaskOption } from "@/lib/triage/types";

type Props = {
  isRunning: boolean;
  tasks: LiveTaskOption[];
  onSubmit: (scenario: string) => void;
  submitLabel?: string;
};

export function InputPanel({
  isRunning,
  tasks,
  onSubmit,
  submitLabel = "Assess case",
}: Props) {
  const [scenario, setScenario] = useState("");
  const [taskId, setTaskId] = useState<string>(tasks[0]?.id ?? "");
  const [suggestions, setSuggestions] = useState<IntakeSuggestion[]>([]);

  const selectedTask = tasks.find((task) => task.id === taskId) ?? tasks[0] ?? null;

  useEffect(() => {
    if (!scenario.trim()) {
      return;
    }

    const timeout = setTimeout(async () => {
      const response = await fetch("/api/triage/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: scenario }),
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { suggestions: IntakeSuggestion[] };
      setSuggestions(payload.suggestions);
      if (payload.suggestions[0]?.taskId) {
        setTaskId(payload.suggestions[0].taskId);
      }
    }, 250);

    return () => clearTimeout(timeout);
  }, [scenario]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = scenario.trim();
    if (!trimmed || isRunning) return;
    onSubmit(trimmed);
    setScenario("");
    setSuggestions([]);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-border bg-surface p-5 shadow-sm"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label
            htmlFor="scenario"
            className="text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]"
          >
            Patient report
          </Label>
          <div className="flex items-center gap-2">
            <Label htmlFor="task" className="text-xs text-[var(--text-muted)]">
              Similar case set
            </Label>
            <Select value={taskId} onValueChange={setTaskId}>
              <SelectTrigger id="task" className="h-8 min-w-[240px]">
                <SelectValue placeholder="Suggested benchmark set" />
              </SelectTrigger>
              <SelectContent>
                {tasks.map((task) => (
                  <SelectItem key={task.id} value={task.id}>
                    <div className="flex flex-col items-start">
                      <span className="text-sm">{task.label}</span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {task.presentingComplaint}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Textarea
          id="scenario"
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
          placeholder={
            "Describe the main complaint, symptoms, and anything worrying you. The system may ask a short follow-up before assigning triage priority."
          }
          className="min-h-[120px] resize-none border-border bg-[var(--surface-secondary)]/40 text-[15px] leading-relaxed placeholder:text-[var(--text-muted)] focus-visible:bg-surface"
          disabled={isRunning}
        />

        <div className="flex items-center justify-between pt-1">
          <div className="text-xs text-[var(--text-muted)]">
            {suggestions[0] ? (
              <>
                <p>
                  Closest similar case: {suggestions[0].diagnosis}
                </p>
                <p className="mt-1">Background benchmark set: {suggestions[0].caseLabel}</p>
              </>
            ) : selectedTask ? (
              <>
                <p>{selectedTask.presentingComplaint}</p>
                <p className="mt-1">The app uses nearby dataset cases behind the scenes for evaluation.</p>
              </>
            ) : (
              <p>Describe the case to start triage.</p>
            )}
          </div>
          <Button
            type="submit"
            disabled={isRunning || !scenario.trim()}
            className="rounded-full bg-[var(--accent)] px-5 text-[var(--accent-foreground)] shadow-none hover:bg-[var(--accent-hover)] hover:text-[var(--accent-foreground)]"
          >
            <Send className="h-4 w-4" />
            {isRunning ? "Assessing..." : submitLabel}
          </Button>
        </div>
      </div>

      {suggestions.length > 0 ? (
        <div className="mt-4 rounded-xl border border-[var(--thinking-border)] bg-[var(--thinking-bg)] px-4 py-3">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--thinking-text)]">
            Similar historical cases
          </p>
          <ul className="mt-2 space-y-2 text-[12.5px] text-[var(--text-secondary)]">
            {suggestions.map((suggestion) => (
              <li key={`${suggestion.taskId}-${suggestion.diagnosis}`}>
                <button
                  type="button"
                  onClick={() => setTaskId(suggestion.taskId)}
                  className="w-full rounded-lg px-2 py-1 text-left hover:bg-white/40"
                >
                  <span className="font-medium text-foreground">{suggestion.caseLabel}</span>
                  {" · "}
                  {suggestion.diagnosis}
                  {" · "}
                  {Math.round(suggestion.score * 100)}% match
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
