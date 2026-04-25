"use client";

import { useState, type FormEvent } from "react";
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
import { ENVIRONMENT_OPTIONS } from "@/lib/triage/mock-agent";
import type { EnvironmentType } from "@/lib/triage/types";

const PLACEHOLDERS: Record<EnvironmentType, string> = {
  general:
    "Describe the situation. What's happening, what's at stake, and what decision are you trying to make?",
  planning:
    "e.g. New-build extension submitted, neighbour objection on overlooking grounds, awaiting officer review.",
  clinical:
    "e.g. 58 y/o with chest tightness for 2 hours, BP 142/88, HR 96, no prior cardiac history.",
  compliance:
    "e.g. Vendor SOC 2 report shows a control exception in access reviews; renewal is in 3 weeks.",
  incident:
    "e.g. p99 latency on checkout-api jumped 4× at 14:02 UTC, correlates with the 13:58 deploy.",
};

type Props = {
  isRunning: boolean;
  onSubmit: (scenario: string, environment: EnvironmentType) => void;
};

export function InputPanel({ isRunning, onSubmit }: Props) {
  const [scenario, setScenario] = useState("");
  const [environment, setEnvironment] = useState<EnvironmentType>("general");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = scenario.trim();
    if (!trimmed || isRunning) return;
    onSubmit(trimmed, environment);
    setScenario("");
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
            Scenario
          </Label>
          <div className="flex items-center gap-2">
            <Label
              htmlFor="environment"
              className="text-xs text-[var(--text-muted)]"
            >
              Environment
            </Label>
            <Select
              value={environment}
              onValueChange={(value) =>
                setEnvironment(value as EnvironmentType)
              }
            >
              <SelectTrigger id="environment" className="h-8 min-w-[180px]">
                <SelectValue placeholder="Select environment" />
              </SelectTrigger>
              <SelectContent>
                {ENVIRONMENT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex flex-col items-start">
                      <span className="text-sm">{opt.label}</span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {opt.hint}
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
          placeholder={PLACEHOLDERS[environment]}
          className="min-h-[120px] resize-none border-border bg-[var(--surface-secondary)]/40 text-[15px] leading-relaxed placeholder:text-[var(--text-muted)] focus-visible:bg-surface"
          disabled={isRunning}
        />

        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-[var(--text-muted)]">
            Output: structured decision + standardised actions.
          </p>
          <Button
            type="submit"
            disabled={isRunning || !scenario.trim()}
            className="rounded-full bg-[var(--accent)] px-5 text-[var(--accent-foreground)] shadow-none hover:bg-[var(--accent-hover)] hover:text-[var(--accent-foreground)]"
          >
            <Send className="h-4 w-4" />
            {isRunning ? "Running…" : "Run simulation"}
          </Button>
        </div>
      </div>
    </form>
  );
}
