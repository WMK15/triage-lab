"use client";

import { useState, type FormEvent } from "react";
import { Plus, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { BatchPreview } from "./batch-preview";
import {
  ManualPatientCard,
  emptyManualPatient,
} from "./manual-patient-card";

import type {
  LiveTaskOption,
  ManualPatient,
  RunMode,
  RunRequest,
} from "@/lib/triage/types";

type Props = {
  isRunning: boolean;
  tasks: LiveTaskOption[];
  onSubmit: (request: RunRequest) => void;
};

const BATCH_SIZES = [3, 5, 8, 10] as const;
const MANUAL_CAP = 8;

const TABS: Array<{ id: RunMode; label: string }> = [
  { id: "test", label: "Test batch" },
  { id: "manual-single", label: "Manual single" },
  { id: "manual-multi", label: "Manual multi" },
];

export function InputPanel({ isRunning, tasks, onSubmit }: Props) {
  const [mode, setMode] = useState<RunMode>("test");

  // Test batch state
  const [taskId, setTaskId] = useState<string>(tasks[0]?.id ?? "");
  const [batchSize, setBatchSize] = useState<number>(5);
  const [extraOn, setExtraOn] = useState(false);
  const [extraText, setExtraText] = useState("");

  // Manual single state
  const [singlePatient, setSinglePatient] = useState<ManualPatient>(
    emptyManualPatient(),
  );

  // Manual multi state
  const [multiPatients, setMultiPatients] = useState<ManualPatient[]>([
    emptyManualPatient(),
  ]);

  const submitDisabled = (() => {
    if (isRunning) return true;
    if (mode === "test") return !taskId;
    if (mode === "manual-single") return singlePatient.chiefComplaint.trim().length === 0;
    return (
      multiPatients.filter((p) => p.chiefComplaint.trim().length > 0).length === 0
    );
  })();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (submitDisabled) return;

    let request: RunRequest;
    if (mode === "test") {
      request = {
        mode: "test",
        taskId,
        batchSize,
        extraPatient: extraOn && extraText.trim().length > 0
          ? extraText.trim()
          : undefined,
      };
    } else if (mode === "manual-single") {
      request = { mode: "manual-single", patient: singlePatient };
    } else {
      const cleaned = multiPatients.filter(
        (p) => p.chiefComplaint.trim().length > 0,
      );
      request = { mode: "manual-multi", patients: cleaned };
    }
    onSubmit(request);
  };

  const updateMultiAt = (idx: number, patient: ManualPatient) => {
    setMultiPatients((prev) =>
      prev.map((p, i) => (i === idx ? patient : p)),
    );
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-border bg-surface p-5 shadow-sm"
    >
      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-3">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMode(tab.id)}
            className={
              "rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors " +
              (mode === tab.id
                ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                : "bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]/70")
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-4 pt-4">
        {mode === "test" ? (
          <>
            <div className="flex items-center gap-3">
              <Label className="text-xs uppercase tracking-wider text-[var(--text-muted)]">
                Batch
              </Label>
              <Select value={taskId} onValueChange={setTaskId}>
                <SelectTrigger className="h-9 min-w-[260px]">
                  <SelectValue placeholder="Select batch" />
                </SelectTrigger>
                <SelectContent>
                  {tasks.map((task) => (
                    <SelectItem key={task.id} value={task.id}>
                      <div className="flex flex-col items-start">
                        <span className="text-sm">{task.label}</span>
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {task.hint}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3">
              <Label className="text-xs uppercase tracking-wider text-[var(--text-muted)]">
                Size
              </Label>
              <div className="flex gap-1.5">
                {BATCH_SIZES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setBatchSize(n)}
                    className={
                      "rounded-md px-3 py-1 text-[12px] font-medium transition-colors " +
                      (batchSize === n
                        ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                        : "bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]/70")
                    }
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {taskId ? <BatchPreview taskId={taskId} batchSize={batchSize} /> : null}

            <div className="rounded-xl border border-border bg-[var(--surface-secondary)]/30 p-3">
              <label className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={extraOn}
                  onChange={(e) => setExtraOn(e.target.checked)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                Add intake-note patient (unscored — does not affect composite)
              </label>
              {extraOn ? (
                <Textarea
                  value={extraText}
                  onChange={(e) => setExtraText(e.target.value)}
                  placeholder='e.g. "58yo male, chest pain radiating to left arm, sweating"'
                  className="mt-2 min-h-[80px] resize-none border-border bg-surface text-[14px]"
                />
              ) : null}
            </div>
          </>
        ) : null}

        {mode === "manual-single" ? (
          <ManualPatientCard
            index={0}
            patient={singlePatient}
            onChange={setSinglePatient}
          />
        ) : null}

        {mode === "manual-multi" ? (
          <div className="space-y-3">
            {multiPatients.map((p, i) => (
              <ManualPatientCard
                key={i}
                index={i}
                patient={p}
                onChange={(next) => updateMultiAt(i, next)}
                onRemove={
                  multiPatients.length > 1
                    ? () =>
                        setMultiPatients((prev) =>
                          prev.filter((_, idx) => idx !== i),
                        )
                    : undefined
                }
              />
            ))}
            <button
              type="button"
              disabled={multiPatients.length >= MANUAL_CAP}
              onClick={() =>
                setMultiPatients((prev) => [...prev, emptyManualPatient()])
              }
              className="flex items-center gap-2 rounded-full border border-dashed border-border px-4 py-2 text-[13px] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              title={
                multiPatients.length >= MANUAL_CAP
                  ? "Cap of 8 patients per run to keep cost predictable."
                  : ""
              }
            >
              <Plus className="h-3 w-3" />
              Add another patient ({multiPatients.length}/{MANUAL_CAP})
            </button>
          </div>
        ) : null}

        <div className="flex items-center justify-end pt-2">
          <Button
            type="submit"
            disabled={submitDisabled}
            className="rounded-full bg-[var(--accent)] px-5 text-[var(--accent-foreground)] shadow-none hover:bg-[var(--accent-hover)] hover:text-[var(--accent-foreground)]"
          >
            <Send className="h-4 w-4" />
            {isRunning
              ? "Running…"
              : mode === "test"
                ? `Run batch (${batchSize}${extraOn && extraText.trim() ? "+1" : ""} patients)`
                : mode === "manual-single"
                  ? "Run single classification"
                  : `Run ${
                      multiPatients.filter((p) => p.chiefComplaint.trim().length > 0)
                        .length
                    } classifications`}
          </Button>
        </div>
      </div>
    </form>
  );
}
