"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";

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
import type {
  KtasLevel,
  ManualPatient,
  MentalState,
} from "@/lib/triage/types";

type Props = {
  index: number;
  patient: ManualPatient;
  onChange: (next: ManualPatient) => void;
  onRemove?: () => void;
};

const KTAS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "(unscored — no expectation)" },
  { value: "1", label: "1 — immediate" },
  { value: "2", label: "2 — very urgent" },
  { value: "3", label: "3 — urgent" },
  { value: "4", label: "4 — standard" },
  { value: "5", label: "5 — not urgent" },
];

const MENTAL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "(unspecified)" },
  { value: "alert", label: "alert" },
  { value: "verbal", label: "verbal response" },
  { value: "pain", label: "pain response" },
  { value: "unresponsive", label: "unresponsive" },
];

function NumberField({
  label,
  value,
  onChange,
  placeholder,
  min,
  max,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  placeholder?: string;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </span>
      <input
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") onChange(null);
          else {
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : null);
          }
        }}
        className="h-9 rounded-lg border border-border bg-[var(--surface-secondary)]/40 px-3 text-[13px] focus:bg-surface focus:outline-none"
      />
    </label>
  );
}

export function ManualPatientCard({ index, patient, onChange, onRemove }: Props) {
  const [open, setOpen] = useState(false);

  const update = (partial: Partial<ManualPatient>) =>
    onChange({ ...patient, ...partial });

  const updateVitals = (
    partial: Partial<NonNullable<ManualPatient["vitals"]>>,
  ) =>
    onChange({
      ...patient,
      vitals: { ...(patient.vitals ?? {}), ...partial },
    });

  return (
    <div className="rounded-2xl border border-border bg-[var(--surface-secondary)]/30 p-4 shadow-sm">
      <div className="flex items-center justify-between pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Patient {index + 1}
        </span>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-full p-1 text-[var(--text-muted)] hover:bg-white/40 hover:text-foreground"
            aria-label="Remove patient"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <Textarea
        value={patient.chiefComplaint}
        onChange={(e) => update({ chiefComplaint: e.target.value })}
        placeholder="Describe the patient: chief complaint, vitals if known, anything relevant. Free text."
        className="min-h-[80px] resize-none border-border bg-surface text-[14px] leading-relaxed placeholder:text-[var(--text-muted)]"
      />

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 flex items-center gap-1 text-[12px] text-[var(--text-secondary)] hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Structured fields (optional — overrides regex extraction)
      </button>

      {open ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberField
            label="Age"
            value={patient.age}
            onChange={(v) => update({ age: v })}
            min={0}
            max={130}
          />
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Sex
            </span>
            <Select
              value={patient.sex ?? ""}
              onValueChange={(v) =>
                update({ sex: v === "" ? null : (v as "M" | "F") })
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="(unspecified)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value=" ">(unspecified)</SelectItem>
                <SelectItem value="F">F</SelectItem>
                <SelectItem value="M">M</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <NumberField
            label="HR"
            value={patient.vitals?.hr}
            onChange={(v) => updateVitals({ hr: v })}
            min={20}
            max={220}
          />
          <NumberField
            label="SBP"
            value={patient.vitals?.sbp}
            onChange={(v) => updateVitals({ sbp: v })}
            min={40}
            max={260}
          />
          <NumberField
            label="DBP"
            value={patient.vitals?.dbp}
            onChange={(v) => updateVitals({ dbp: v })}
            min={20}
            max={160}
          />
          <NumberField
            label="RR"
            value={patient.vitals?.rr}
            onChange={(v) => updateVitals({ rr: v })}
            min={4}
            max={60}
          />
          <NumberField
            label="SpO2 %"
            value={patient.vitals?.spo2}
            onChange={(v) => updateVitals({ spo2: v })}
            min={50}
            max={100}
          />
          <NumberField
            label="Temp °C"
            value={patient.vitals?.tempC}
            onChange={(v) => updateVitals({ tempC: v })}
            min={30}
            max={45}
          />
          <NumberField
            label="NRS pain"
            value={patient.nrsPain}
            onChange={(v) => update({ nrsPain: v })}
            min={0}
            max={10}
          />
          <label className="col-span-2 flex flex-col gap-1 sm:col-span-3">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Mental state
            </span>
            <Select
              value={patient.mentalState ?? ""}
              onValueChange={(v) =>
                update({ mentalState: v === "" ? null : (v as MentalState) })
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="(unspecified)" />
              </SelectTrigger>
              <SelectContent>
                {MENTAL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value || "blank"} value={opt.value || " "}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3 border-t border-border pt-3">
        <Label className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Expected level (optional)
        </Label>
        <Select
          value={patient.expectedKtas != null ? String(patient.expectedKtas) : ""}
          onValueChange={(v) =>
            update({
              expectedKtas:
                v === "" || v === " " ? null : (Number(v) as KtasLevel),
            })
          }
        >
          <SelectTrigger className="h-8 min-w-[260px]">
            <SelectValue placeholder="(unscored — no expectation)" />
          </SelectTrigger>
          <SelectContent>
            {KTAS_OPTIONS.map((opt) => (
              <SelectItem
                key={opt.value || "blank"}
                value={opt.value === "" ? " " : opt.value}
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function emptyManualPatient(): ManualPatient {
  return {
    chiefComplaint: "",
    age: null,
    sex: null,
    vitals: null,
    mentalState: null,
    nrsPain: null,
    expectedKtas: null,
  };
}

export const _internal = { Button };
