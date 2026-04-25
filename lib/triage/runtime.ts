import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

import type {
  Action,
  AssessResponse,
  IntakeSuggestion,
  LiveTaskOption,
  ManualPatient,
  PatientPreview,
  RunRequest,
  Severity,
  ThinkingStep,
  Decision,
} from "@/lib/triage/types";

const ROOT = process.cwd();
const TRIAGE_NURSE_DIR = path.join(ROOT, "triage-nurse");
const RUNS_DIR = path.join(TRIAGE_NURSE_DIR, "runs");
const COMBINED_TRIAGE_REFERENCE_CSV = path.join(ROOT, "dataset", "combined-triage-reference.csv");
const DATASET_CSV = path.join(ROOT, "dataset", "emergency-triage.csv");
const SYMPTOM_REFERENCE_CSV = path.join(ROOT, "dataset", "symptom-triage-reference.csv");
const ED_TRIAGE_CSV = path.join(ROOT, "dataset", "ed", "triage.csv");
const TRIAGE_NURSE_ENV_FILE = path.join(TRIAGE_NURSE_DIR, ".env");
const ENV_URL = "http://127.0.0.1:8080";
const ENV_PING_TIMEOUT_MS = 1500;
const ENV_BOOT_TIMEOUT_MS = 15000;
const ENV_START_LOG = path.join("/tmp", "triage-nurse-env-next.log");

/**
 * Resolve a `uv` binary across machines:
 *   1. UV_BIN env var (override)
 *   2. ~/.local/bin/uv (the installer's default)
 *   3. /opt/homebrew/bin/uv (Apple Silicon brew)
 *   4. /usr/local/bin/uv (Intel brew or manual install)
 *   5. /usr/bin/uv (some Linux package managers)
 *   6. Plain "uv" — relies on PATH; works for hand-run dev shells.
 */
function resolveUvBin(): string {
  if (process.env.UV_BIN && fs.existsSync(process.env.UV_BIN)) {
    return process.env.UV_BIN;
  }
  const home = process.env.HOME ?? "";
  const candidates = [
    home ? path.join(home, ".local", "bin", "uv") : null,
    "/opt/homebrew/bin/uv",
    "/usr/local/bin/uv",
    "/usr/bin/uv",
  ].filter((p): p is string => Boolean(p));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "uv";
}

const UV_BIN = resolveUvBin();

type LiveTask = {
  id: string;
  name: string;
  row_indices: number[];
  ground_truth_ktas: number[];
  max_turns: number;
  shift_length_min: number;
  seed: number;
  n: number;
};

type DatasetRow = {
  chiefComplaint: string;
  diagnosis: string;
  taskId: string;
  referenceLevel: number | null;
  highAcuity: boolean;
  source: "ktas" | "symptom_reference" | "ed_triage";
};

type IntakeAssessment = {
  severity: Severity;
  headline: string;
  rationale: string;
  progress: number;
  actions: Action[];
};

type PerPatientAssignment = {
  patient_id: string;
  agent_level: number;
  truth_level: number | null;
  reward: number | null;
  order: number;
  scored: boolean;
  source: "dataset" | "manual";
  chief_complaint: string;
};

type SavedResponsePatient = {
  id: string;
  chiefComplaint: string;
  truthLevel: number | null;
  source: "dataset" | "manual";
};

export type EpisodeData = {
  id: string;
  result: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  trajectory: Array<Record<string, unknown>>;
  rewards: Array<Record<string, unknown>>;
};

export type EpisodeRow = {
  id: string;
  modifiedAt: number;
  hasResult: boolean;
  trajectoryEvents: number;
  task: string | null;
  disposition: string | null;
  score: number | null;
  summary: string | null;
};

const KTAS_NAMES: Record<number, string> = {
  1: "immediate",
  2: "very_urgent",
  3: "urgent",
  4: "standard",
  5: "not_urgent",
};

function readJsonFile(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
}

function readJsonlFile(filePath: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

let configuredAgentModelCache: string | null = null;

function configuredAgentModel(): string {
  if (configuredAgentModelCache) return configuredAgentModelCache;

  if (process.env.TRIAGE_NURSE_AGENT_MODEL?.trim()) {
    configuredAgentModelCache = process.env.TRIAGE_NURSE_AGENT_MODEL.trim();
    return configuredAgentModelCache;
  }

  if (fs.existsSync(TRIAGE_NURSE_ENV_FILE)) {
    const raw = fs.readFileSync(TRIAGE_NURSE_ENV_FILE, "utf-8");
    const match = raw.match(/^\s*TRIAGE_NURSE_AGENT_MODEL\s*=\s*(.+)\s*$/m);
    if (match?.[1]) {
      configuredAgentModelCache = match[1].trim().replace(/^['"]|['"]$/g, "");
      return configuredAgentModelCache;
    }
  }

  configuredAgentModelCache = "gpt-5-mini";
  return configuredAgentModelCache;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normaliseText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function readDelimitedRows(
  filePath: string,
  delimiter: string,
  encoding: BufferEncoding = "utf-8",
): { headers: string[]; rows: string[][] } {
  if (!fs.existsSync(filePath)) {
    return { headers: [], rows: [] };
  }

  const raw = fs.readFileSync(filePath, encoding);
  const [headerLine, ...lines] = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!headerLine) {
    return { headers: [], rows: [] };
  }

  return {
    headers: parseDelimitedLine(headerLine, delimiter),
    rows: lines.map((line) => parseDelimitedLine(line, delimiter)),
  };
}

const QUERY_ALIAS_RULES = [
  {
    patterns: [/\bheart attack\b/, /\bmyocardial infarction\b/, /\bmi\b/],
    phrases: [
      "acute severe chest pain",
      "chest pain radiating to jaw arm back",
      "shortness of breath",
      "acute coronary syndrome",
    ],
  },
  {
    patterns: [/\bstroke\b/, /\bfacial droop\b/, /\bslurred speech\b/, /\bspeech difficulty\b/],
    phrases: [
      "sudden focal neurological deficit",
      "facial droop",
      "arm weakness",
      "speech difficulty",
      "vision loss acute",
    ],
  },
  {
    patterns: [
      /\bshortness of breath\b/,
      /\btrouble breathing\b/,
      /\bcannot breathe\b/,
      /\bcan t breathe\b/,
      /\bsob\b/,
      /\bdyspnea\b/,
    ],
    phrases: ["severe dyspnea at rest", "shortness of breath", "respiratory distress"],
  },
  {
    patterns: [/\bfainting\b/, /\bfainted\b/, /\bpassed out\b/, /\bsyncope\b/],
    phrases: ["syncope", "loss of consciousness"],
  },
  {
    patterns: [/\bvomiting blood\b/, /\bthrowing up blood\b/, /\bhematemesis\b/],
    phrases: ["hematemesis", "vomiting blood", "upper gi bleed"],
  },
  {
    patterns: [/\bseizure\b/, /\bconvulsion\b/],
    phrases: ["seizure active or post ictal"],
  },
  {
    patterns: [/\bconfused\b/, /\baltered mental status\b/, /\bnot acting right\b/],
    phrases: ["acute altered mental status"],
  },
];

let liveTasksCache: LiveTaskOption[] | null = null;

function fetchTasksJson(): LiveTask[] {
  // Spawn `uv run python -m triage_nurse.harness --list-tasks` in
  // triage-nurse/. The harness exits 0 with task JSON on stdout. No LLM
  // key needed for this code path.
  const result = spawnSync(
    UV_BIN,
    ["run", "python", "-m", "triage_nurse.harness", "--list-tasks"],
    {
      cwd: TRIAGE_NURSE_DIR,
      encoding: "utf-8",
    },
  );
  if (result.status !== 0) {
    const stderr = result.stderr || "(no stderr)";
    throw new Error(
      `triage-nurse harness --list-tasks failed (exit ${result.status}): ${stderr}`,
    );
  }
  return JSON.parse(result.stdout) as LiveTask[];
}

function liveTaskOption(task: LiveTask): LiveTaskOption {
  const ktasSummary = task.ground_truth_ktas
    .map((k) => `${k} (${KTAS_NAMES[k] ?? "?"})`)
    .join(", ");
  return {
    id: task.id,
    name: task.name,
    label: task.name,
    hint: `${task.n} patients · KTAS levels ${ktasSummary}`,
    narrativeRole: "batch_classification",
    presentingComplaint: `Mixed waiting room — ${task.n} patients across the KTAS levels`,
    expectedDisposition: `classify all ${task.n}`,
  } satisfies LiveTaskOption;
}

export function listLiveTasks(): LiveTaskOption[] {
  if (liveTasksCache) return liveTasksCache;
  try {
    const tasks = fetchTasksJson();
    liveTasksCache = tasks.map(liveTaskOption);
  } catch (error) {
    console.warn("[runtime] could not fetch live tasks:", error);
    liveTasksCache = [];
  }
  return liveTasksCache;
}

let datasetCache: DatasetRow[] | null = null;

function taskIdForIndex(index: number): string {
  const taskIds = listLiveTasks().map((task) => task.id);
  if (taskIds.length === 0) return `dataset-row-${index}`;
  return taskIds[index % taskIds.length];
}

function appendAliasPhrases(query: string): string {
  const additions = QUERY_ALIAS_RULES.flatMap((rule) =>
    rule.patterns.some((pattern) => pattern.test(query)) ? rule.phrases : [],
  );
  return additions.length > 0 ? `${query} ${additions.join(" ")}` : query;
}

function expandedIntakeText(history: string[]): string {
  return appendAliasPhrases(normaliseText(history.join(" ")));
}

function assessmentFromLevel(level: number, rationale: string): IntakeAssessment {
  if (level <= 1) {
    return {
      severity: "critical",
      headline: "Immediate triage required",
      rationale,
      progress: 100,
      actions: [
        {
          id: "critical-bed",
          label: "Move to resuscitation bay",
          description: "Do not keep this patient in the waiting room.",
          intent: "escalation",
        },
        {
          id: "critical-team",
          label: "Alert senior clinician",
          description: "Immediate bedside assessment is warranted.",
          intent: "escalation",
        },
        {
          id: "critical-monitor",
          label: "Start continuous monitoring",
          description: "Track vitals while urgent treatment starts.",
        },
      ],
    };
  }

  if (level === 2) {
    return {
      severity: "high",
      headline: "Very urgent triage",
      rationale,
      progress: 90,
      actions: [
        {
          id: "high-room",
          label: "Place in monitored bed",
          description: "Keep the patient where repeat observations are easy.",
          intent: "escalation",
        },
        {
          id: "high-obs",
          label: "Repeat vitals now",
          description: "Recheck objective instability before clinician review.",
        },
        {
          id: "high-escalate",
          label: "Escalate to urgent review",
          description: "Prioritize medical assessment over standard queue order.",
          intent: "constructive",
        },
      ],
    };
  }

  if (level === 3) {
    return {
      severity: "moderate",
      headline: "Urgent triage",
      rationale,
      progress: 78,
      actions: [
        {
          id: "moderate-zone",
          label: "Keep in urgent queue",
          description: "Move ahead of routine complaints but without resuscitation-level response.",
          intent: "constructive",
        },
        {
          id: "moderate-analgesia",
          label: "Start comfort measures",
          description: "Offer early pain control, hydration, or wound care if appropriate.",
        },
        {
          id: "moderate-watch",
          label: "Watch for deterioration",
          description: "Upgrade priority if symptoms worsen or new red flags appear.",
        },
      ],
    };
  }

  return {
    severity: "low",
    headline: "Standard triage",
    rationale,
    progress: 65,
    actions: [
      {
        id: "low-queue",
        label: "Keep in standard queue",
        description: "Routine review appears reasonable based on the current description.",
      },
      {
        id: "low-safety-net",
        label: "Give return precautions",
        description: "Advise the patient to report worsening pain, breathing issues, or collapse.",
      },
      {
        id: "low-refresh",
        label: "Recheck if waiting extends",
        description: "Repeat the screen if new symptoms develop while waiting.",
      },
    ],
  };
}

function strongestReferenceMatch(query: string): DatasetRow | null {
  let best: { row: DatasetRow; level: number; score: number } | null = null;

  for (const row of loadDatasetRows()) {
    if (row.referenceLevel === null) continue;
    const complaintScore = overlapScore(query, row.chiefComplaint);
    const diagnosisScore = overlapScore(query, row.diagnosis);
    const score = Math.max(complaintScore, diagnosisScore * 0.9);
    if (score < 0.2) continue;

    const level = row.referenceLevel;
    if (
      best === null ||
      level < best.level ||
      (level === best.level && score > best.score)
    ) {
      best = { row, level, score };
    }
  }

  return best?.row ?? null;
}

function hasImmediateRedFlags(text: string): boolean {
  return mentionsAny(text, [
    "heart attack",
    "acute severe chest pain",
    "chest pain radiating",
    "shortness of breath",
    "severe dyspnea",
    "cannot breathe",
    "stroke",
    "facial droop",
    "arm weakness",
    "speech difficulty",
    "loss of consciousness",
    "syncope",
    "hematemesis",
    "vomiting blood",
    "acute altered mental status",
    "sudden focal neurological deficit",
  ]);
}

function loadDatasetRows(): DatasetRow[] {
  if (datasetCache) return datasetCache;

  if (fs.existsSync(COMBINED_TRIAGE_REFERENCE_CSV)) {
    const combined = readDelimitedRows(COMBINED_TRIAGE_REFERENCE_CSV, ",");
    const sourceIndex = combined.headers.indexOf("source");
    const chiefIndex = combined.headers.indexOf("chief_complaint");
    const diagnosisIndex = combined.headers.indexOf("diagnosis");
    const levelIndex = combined.headers.indexOf("reference_level");
    const highIndex = combined.headers.indexOf("high_acuity");

    datasetCache = combined.rows.map((cols, index) => {
      const level = Number.parseInt(cols[levelIndex] ?? "", 10) || null;
      const source = cols[sourceIndex];
      return {
        chiefComplaint: cols[chiefIndex] ?? "",
        diagnosis: cols[diagnosisIndex] ?? "",
        taskId: taskIdForIndex(index),
        referenceLevel: level,
        highAcuity: (cols[highIndex] ?? "").toLowerCase() === "yes" || (level !== null && level <= 2),
        source:
          source === "symptom_reference" || source === "ed_triage" ? source : "ktas",
      } satisfies DatasetRow;
    });

    return datasetCache;
  }

  const primary = readDelimitedRows(DATASET_CSV, ";", "latin1");
  const symptomReference = readDelimitedRows(SYMPTOM_REFERENCE_CSV, ",");
  const edTriage = readDelimitedRows(ED_TRIAGE_CSV, ",");

  const primaryChiefIndex = primary.headers.indexOf("Chief_complain");
  const primaryDiagnosisIndex = primary.headers.indexOf("Diagnosis in ED");
  const primaryKtasIndex = primary.headers.indexOf("KTAS_expert");

  const primaryRows = primary.rows.map((cols, index) => ({
    chiefComplaint: cols[primaryChiefIndex] ?? "",
    diagnosis: cols[primaryDiagnosisIndex] ?? "",
    taskId: taskIdForIndex(index),
    referenceLevel: Number.parseInt(cols[primaryKtasIndex] ?? "", 10) || null,
    highAcuity: [1, 2].includes(Number.parseInt(cols[primaryKtasIndex] ?? "", 10)),
    source: "ktas",
  })) satisfies DatasetRow[];

  const symptomNameIndex = symptomReference.headers.indexOf("symptom_name");
  const symptomLevelIndex = symptomReference.headers.indexOf("typical_triage_level");
  const symptomRuleOutIndex = symptomReference.headers.indexOf("must_rule_out");
  const symptomModifierIndex = symptomReference.headers.indexOf("high_acuity_modifier");

  const symptomRows = symptomReference.rows.map((cols, index) => {
    const level = Number.parseInt(cols[symptomLevelIndex] ?? "", 10) || null;
    const symptom = cols[symptomNameIndex] ?? "";
    const ruleOut = cols[symptomRuleOutIndex] ?? "";
    return {
      chiefComplaint: symptom,
      diagnosis: ruleOut || symptom,
      taskId: taskIdForIndex(primaryRows.length + index),
      referenceLevel: level,
      highAcuity:
        cols[symptomModifierIndex]?.toLowerCase() === "yes" || (level !== null && level <= 2),
      source: "symptom_reference",
    } satisfies DatasetRow;
  });

  const edComplaintIndex = edTriage.headers.indexOf("chiefcomplaint");
  const edAcuityIndex = edTriage.headers.indexOf("acuity");

  const edRows = edTriage.rows.map((cols, index) => {
    const acuity = Number.parseInt(cols[edAcuityIndex] ?? "", 10) || null;
    const complaint = cols[edComplaintIndex] ?? "";
    return {
      chiefComplaint: complaint,
      diagnosis: complaint,
      taskId: taskIdForIndex(primaryRows.length + symptomRows.length + index),
      referenceLevel: acuity,
      highAcuity: acuity !== null && acuity <= 2,
      source: "ed_triage",
    } satisfies DatasetRow;
  });

  datasetCache = [...primaryRows, ...symptomRows, ...edRows].filter(
    (row) => row.chiefComplaint || row.diagnosis,
  );

  return datasetCache;
}

function overlapScore(query: string, target: string): number {
  const qWords = new Set(normaliseText(query).split(" ").filter(Boolean));
  const tWords = new Set(normaliseText(target).split(" ").filter(Boolean));
  if (qWords.size === 0 || tWords.size === 0) return 0;

  let matches = 0;
  for (const word of qWords) {
    if (tWords.has(word)) matches += 1;
  }
  return matches / qWords.size;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function ktasTool(level: number): string {
  if (level === 1) return "assign_immediate";
  if (level === 2) return "assign_very_urgent";
  if (level === 3) return "assign_urgent";
  if (level === 4) return "assign_standard";
  return "assign_not_urgent";
}

function ktasFromSeverity(severity: Severity): number {
  if (severity === "critical") return 1;
  if (severity === "high") return 2;
  if (severity === "moderate") return 3;
  return 4;
}

function assignmentReward(agentLevel: number, truthLevel: number): number {
  const gap = Math.abs(agentLevel - truthLevel);
  const base = Math.max(0, 1 - 0.4 * gap);
  return agentLevel > truthLevel ? base * 0.5 : base;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function writeJsonlFile(filePath: string, records: Array<Record<string, unknown>>) {
  fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join("\n"));
}

function safeEpisodePart(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-z0-9-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "batch"
  ).toLowerCase();
}

function orderingBonus(assignments: PerPatientAssignment[]): number {
  const scored = assignments.filter((assignment) => assignment.truth_level != null);
  if (scored.length === 0) return 0;

  const truths = scored.map((assignment) => assignment.truth_level as number);
  if (new Set(truths).size === 1) return 0;

  const firstScored = scored.reduce((best, assignment) =>
    assignment.order < best.order ? assignment : best,
  );
  if (firstScored.truth_level === Math.min(...truths)) return 0.1;
  if (firstScored.truth_level === Math.max(...truths)) return -0.1;
  return 0;
}

function scoreAssignments(assignments: PerPatientAssignment[]): {
  baseReward: number | null;
  orderingBonus: number;
  compositeScore: number | null;
} {
  const scored = assignments.filter(
    (assignment) => assignment.scored && assignment.reward != null,
  );
  const bonus = orderingBonus(assignments);
  if (scored.length === 0) {
    return { baseReward: null, orderingBonus: bonus, compositeScore: null };
  }

  const baseReward =
    scored.reduce((sum, assignment) => sum + Number(assignment.reward), 0) /
    scored.length;
  return {
    baseReward,
    orderingBonus: bonus,
    compositeScore: clamp01(baseReward + bonus),
  };
}

function evaluationSummary(assignments: PerPatientAssignment[]): Record<string, unknown> | null {
  const scored = assignments.filter(
    (assignment) => assignment.scored && assignment.truth_level != null,
  );
  if (scored.length === 0) return null;

  const confusion: Record<string, Record<string, number>> = {
    "1": {},
    "2": {},
    "3": {},
    "4": {},
    "5": {},
  };
  for (const assignment of scored) {
    const agent = String(assignment.agent_level);
    const truth = String(assignment.truth_level);
    confusion[agent][truth] = (confusion[agent][truth] ?? 0) + 1;
  }

  const exactMatches = scored.filter(
    (assignment) => assignment.agent_level === assignment.truth_level,
  ).length;
  const overTriage = scored.filter(
    (assignment) =>
      assignment.truth_level != null && assignment.agent_level < assignment.truth_level,
  ).length;
  const underTriage = scored.filter(
    (assignment) =>
      assignment.truth_level != null && assignment.agent_level > assignment.truth_level,
  ).length;
  const offByOne = scored.filter(
    (assignment) =>
      assignment.truth_level != null &&
      Math.abs(assignment.agent_level - assignment.truth_level) === 1,
  ).length;

  return {
    scored_count: scored.length,
    exact_matches: exactMatches,
    over_triage: overTriage,
    under_triage: underTriage,
    exact_rate: exactMatches / scored.length,
    mistriage_rate: 1 - exactMatches / scored.length,
    under_triage_rate: underTriage / scored.length,
    off_by_one_count: offByOne,
    off_by_two_or_more_count: scored.length - exactMatches - offByOne,
    confusion,
  };
}

function savedResponsePatientLevel(patient: SavedResponsePatient): number {
  if (patient.truthLevel != null) return patient.truthLevel;
  return ktasFromSeverity(extractAssessment([patient.chiefComplaint]).severity);
}

function savedResponseFinalText(
  assignments: PerPatientAssignment[],
  score: ReturnType<typeof scoreAssignments>,
): string {
  const scoredCount = assignments.filter((assignment) => assignment.scored).length;
  const manualCount = assignments.length - scoredCount;
  const lines = [`All ${assignments.length} patients assigned from saved responses.`];

  if (score.compositeScore != null && score.baseReward != null) {
    lines.push(`Composite: ${score.compositeScore.toFixed(3)}`);
    lines.push(`  Base (mean over scored): ${score.baseReward.toFixed(3)}`);
    lines.push(`  Ordering bonus: ${score.orderingBonus.toFixed(2)}`);
  } else {
    lines.push("Composite: (none — pure-manual run, no ground truth)");
  }

  lines.push("");
  lines.push(`Scored: ${scoredCount} | Manual / unscored: ${manualCount}`);
  for (const assignment of assignments) {
    if (assignment.truth_level == null) {
      lines.push(
        `  ${assignment.patient_id}: agent KTAS ${assignment.agent_level} (unscored — no truth)`,
      );
    } else {
      const tag =
        assignment.agent_level === assignment.truth_level
          ? "match"
          : assignment.agent_level < assignment.truth_level
            ? "over"
            : "UNDER";
      lines.push(
        `  ${assignment.patient_id}: agent KTAS ${assignment.agent_level} vs truth ${assignment.truth_level} (${tag}, reward ${assignment.reward?.toFixed(2) ?? "n/a"})`,
      );
    }
  }

  return lines.join("\n");
}

function buildIntakeThinking(
  history: string[],
  matchedCase: IntakeSuggestion | null,
): ThinkingStep[] {
  const latest = history.at(-1) ?? "";
  const steps: ThinkingStep[] = [
    {
      id: "intake",
      label: history.length === 1 ? "Reviewing complaint" : "Reviewing update",
      detail: latest || "Waiting for a complaint.",
    },
  ];

  if (matchedCase) {
    steps.push({
      id: "dataset",
      label: "Cross-checking similar cases",
      detail: `${matchedCase.diagnosis} (${Math.round(matchedCase.score * 100)}% match).`,
    });
  }

  if (history.length > 1) {
    steps.push({
      id: "history",
      label: "Using follow-up answer",
      detail: `${history.length - 1} follow-up response${history.length === 2 ? "" : "s"} captured.`,
    });
  }

  return steps;
}

function mentionsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function extractAssessment(history: string[]): IntakeAssessment {
  const combined = expandedIntakeText(history);
  const referenceMatch = strongestReferenceMatch(combined);

  if (referenceMatch?.referenceLevel) {
    return assessmentFromLevel(
      referenceMatch.referenceLevel,
      `The reported symptoms match a high-priority triage pattern (${referenceMatch.chiefComplaint.toLowerCase()}) and should be escalated accordingly.`,
    );
  }

  const severeDanger = mentionsAny(combined, [
    "not breathing",
    "unconscious",
    "collapsed",
    "seizure",
    "blue",
    "cardiac arrest",
    "cannot breathe",
  ]);
  if (severeDanger) {
    return assessmentFromLevel(
      1,
      "The symptoms suggest an immediate threat to airway, breathing, circulation, or neurologic status.",
    );
  }

  const highRisk = mentionsAny(combined, [
    "heart attack",
    "chest pain",
    "chest tightness",
    "chest pressure",
    "shortness of breath",
    "jaw pain",
    "arm pain",
    "radiating pain",
    "weakness one side",
    "facial droop",
    "speech difficulty",
    "slurred speech",
    "stroke",
    "confused",
    "severe pain",
    "vomiting blood",
    "pregnant bleeding",
    "anaphylaxis",
    "high fever and rash",
    "passed out",
    "fainted",
    "syncope",
  ]);
  if (highRisk) {
    return assessmentFromLevel(
      2,
      "These features can deteriorate quickly and should be assessed ahead of routine waiting-room complaints.",
    );
  }

  const moderateRisk = mentionsAny(combined, [
    "fever",
    "abdominal pain",
    "laceration",
    "dizzy",
    "vomiting",
    "dehydrated",
    "injury",
    "fracture",
    "headache",
  ]);
  if (moderateRisk) {
    return assessmentFromLevel(
      3,
      "The complaint appears significant but does not currently show the strongest immediate red-flag features.",
    );
  }

  return assessmentFromLevel(
    4,
    "The available details fit a lower-acuity presentation that can usually wait for standard assessment.",
  );
}

const FOLLOW_UP_QUESTIONS = [
  {
    id: "duration",
    question: "How long has this been going on, and is it getting worse?",
    triggers: ["pain", "fever", "vomiting", "injury", "bleeding", "shortness of breath"],
  },
  {
    id: "severity",
    question: "Are there any red flags like trouble breathing, fainting, confusion, severe pain, or heavy bleeding?",
    triggers: ["pain", "chest", "breathing", "bleeding", "dizzy", "weakness", "fever"],
  },
  {
    id: "risk",
    question: "What is the patient’s age, and do they have major risks such as pregnancy, heart disease, immune suppression, or recent surgery?",
    triggers: ["fever", "pain", "bleeding", "pregnant", "chest", "abdominal"],
  },
] as const;

function nextFollowUpQuestion(history: string[]): string | null {
  if (history.length === 0) return null;
  if (history.length >= 3) return null;

  const combined = expandedIntakeText(history);
  const referenceMatch = strongestReferenceMatch(combined);
  if (referenceMatch && referenceMatch.referenceLevel !== null && referenceMatch.referenceLevel <= 2) {
    return null;
  }
  if (hasImmediateRedFlags(combined)) {
    return null;
  }

  const asked = history.length - 1;
  const candidate = FOLLOW_UP_QUESTIONS.find((item, index) => {
    if (index < asked) return false;
    return mentionsAny(combined, [...item.triggers]);
  });

  if (candidate) return candidate.question;
  return asked === 0 ? FOLLOW_UP_QUESTIONS[0].question : null;
}

async function isEnvReady(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENV_PING_TIMEOUT_MS);
  try {
    // OpenReward exposes /openapi.json as a reliable readiness probe.
    const res = await fetch(`${ENV_URL}/openapi.json`, {
      signal: controller.signal,
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureEnvServer(): Promise<void> {
  if (await isEnvReady()) return;

  const out = fs.openSync(ENV_START_LOG, "a");
  const child = spawn(UV_BIN, ["run", "python", "-m", "triage_nurse.triage_env"], {
    cwd: TRIAGE_NURSE_DIR,
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();

  const deadline = Date.now() + ENV_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isEnvReady()) return;
    await delay(250);
  }

  throw new Error("triage-nurse env server did not become ready");
}

export function suggestCasesFromIntake(input: string): IntakeSuggestion[] {
  const query = input.trim();
  if (!query) return [];

  const expandedQuery = appendAliasPhrases(normaliseText(query));
  const tasksById = new Map(listLiveTasks().map((task) => [task.id, task]));
  return loadDatasetRows()
    .map((row) => {
      const complaintScore = overlapScore(expandedQuery, row.chiefComplaint);
      const diagnosisScore = overlapScore(expandedQuery, row.diagnosis);
      const sourceBoost =
        row.source === "symptom_reference" ? 0.18 : row.source === "ed_triage" ? 0.12 : 0;
      const acuityBoost = row.highAcuity ? 0.2 : 0;
      const score = Math.min(
        1,
        Math.max(complaintScore, diagnosisScore * 0.9) + sourceBoost + acuityBoost,
      );
      const task = tasksById.get(row.taskId);
      return {
        taskId: row.taskId,
        caseLabel: task?.label ?? row.taskId,
        complaint: row.chiefComplaint || "Unknown complaint",
        diagnosis: row.diagnosis || "Unknown diagnosis",
        disposition: "classify",
        score,
      } satisfies IntakeSuggestion;
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

export async function assessIntake(history: string[]): Promise<AssessResponse> {
  const cleaned = history.map((item) => item.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    throw new Error("history must include at least one complaint or answer");
  }

  const matchedCase = suggestCasesFromIntake(cleaned.join("\n"))[0] ?? null;
  const thinking = buildIntakeThinking(cleaned, matchedCase);
  const followUpQuestion = nextFollowUpQuestion(cleaned);

  if (followUpQuestion) {
    return {
      kind: "question",
      question: followUpQuestion,
      summary: matchedCase
        ? `Closest similar dataset case: ${matchedCase.diagnosis}.`
        : "Collecting a bit more detail before assigning triage priority.",
      matchedCase,
      thinking,
    } satisfies AssessResponse;
  }

  const assessment = extractAssessment(cleaned);
  const matchedText = matchedCase
    ? ` A similar historical case matched ${matchedCase.diagnosis.toLowerCase()} from the dataset.`
    : "";
  const decision: Decision = {
    headline: assessment.headline,
    rationale: sentence(`${assessment.rationale}${matchedText}`),
    severity: assessment.severity,
    caseProgress: assessment.progress,
  };

  return {
    kind: "decision",
    decision,
    actions: assessment.actions,
    acknowledgement:
      "The visible triage recommendation is ready. Benchmark evaluation can continue in the background.",
    matchedCase,
    thinking,
  } satisfies AssessResponse;
}

export function getEpisodeData(id: string): EpisodeData | null {
  const safeId = path.basename(id);
  const dir = path.join(RUNS_DIR, safeId);
  if (!fs.existsSync(dir)) return null;

  return {
    id: safeId,
    result: readJsonFile(path.join(dir, "result.json")),
    meta: readJsonFile(path.join(dir, "meta.json")),
    trajectory: readJsonlFile(path.join(dir, "trajectory.jsonl")),
    rewards: readJsonlFile(path.join(dir, "rewards.jsonl")),
  };
}

function pickScore(result: Record<string, unknown> | null): number | null {
  if (!result) return null;
  // Prefer the v2 fields (composite_score / score) before falling back to
  // total_reward (a sum, not normalised — useful only when the others are
  // missing).
  if (typeof result.composite_score === "number") return result.composite_score;
  if (typeof result.score === "number") return result.score;
  if (typeof result.total_reward === "number") return result.total_reward;
  return null;
}

export function listEpisodes(): EpisodeRow[] {
  if (!fs.existsSync(RUNS_DIR)) return [];

  return fs
    .readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const dir = path.join(RUNS_DIR, entry.name);
      const stat = fs.statSync(dir);
      const result = readJsonFile(path.join(dir, "result.json"));
      const trajectory = readJsonlFile(path.join(dir, "trajectory.jsonl"));

      return {
        id: entry.name,
        modifiedAt: stat.mtimeMs,
        hasResult: result !== null,
        trajectoryEvents: trajectory.length,
        task:
          typeof result?.task_id === "string"
            ? result.task_id
            : typeof result?.task === "string"
              ? result.task
              : null,
        disposition:
          typeof result?.disposition === "string" ? result.disposition : null,
        score: pickScore(result),
        summary:
          typeof result?.summary === "string"
            ? result.summary
            : typeof result?.status === "string"
              ? result.status
              : null,
      } satisfies EpisodeRow;
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

// ----- v3: preview + per-mode run dispatch ------------------------------

type PreviewResponse = { task_id?: string; patients: PatientPreview[] };

const previewCache = new Map<string, PatientPreview[]>();

function previewKey(taskId: string, batchSize: number): string {
  return `${taskId}|${batchSize}`;
}

/** Fetch the patients the env will load for a given (taskId, batchSize),
 *  cached in memory. Spawns `uv run python -m triage_nurse.harness --preview`. */
export function previewBatch(
  taskId: string,
  batchSize: number,
): PatientPreview[] {
  const key = previewKey(taskId, batchSize);
  const cached = previewCache.get(key);
  if (cached) return cached;

  const result = spawnSync(
    UV_BIN,
    [
      "run",
      "python",
      "-m",
      "triage_nurse.harness",
      "--preview",
      taskId,
      "--n",
      String(batchSize),
    ],
    { cwd: TRIAGE_NURSE_DIR, encoding: "utf-8" },
  );
  if (result.status !== 0) {
    const stderr = result.stderr || "(no stderr)";
    throw new Error(
      `harness --preview ${taskId} failed (exit ${result.status}): ${stderr}`,
    );
  }
  const parsed = JSON.parse(result.stdout) as PreviewResponse;
  const patients = parsed.patients ?? [];
  previewCache.set(key, patients);
  return patients;
}

function createSavedResponseEpisode(
  request: Extract<RunRequest, { mode: "test" }>,
): { episodeId: string } {
  const previewPatients = previewBatch(request.taskId, request.batchSize);
  const patients: SavedResponsePatient[] = previewPatients.map((patient) => ({
    id: patient.id,
    chiefComplaint: patient.chief_complaint,
    truthLevel: patient.ground_truth_ktas,
    source: "dataset",
  }));

  const extraPatient = request.extraPatient?.trim();
  if (extraPatient) {
    patients.push({
      id: `manual-${patients.filter((patient) => patient.source === "manual").length}`,
      chiefComplaint: extraPatient,
      truthLevel: null,
      source: "manual",
    });
  }

  if (patients.length === 0) {
    throw new Error("saved responses require at least one preview patient");
  }

  const orderedPatients = patients
    .map((patient, index) => ({ patient, index }))
    .sort((a, b) => {
      const acuityA = a.patient.truthLevel ?? 6;
      const acuityB = b.patient.truthLevel ?? 6;
      return acuityA - acuityB || a.index - b.index;
    })
    .map(({ patient }) => patient);

  const assignments = orderedPatients.map((patient, index) => {
    const agentLevel = savedResponsePatientLevel(patient);
    const reward =
      patient.truthLevel == null ? null : assignmentReward(agentLevel, patient.truthLevel);
    return {
      patient_id: patient.id,
      agent_level: agentLevel,
      truth_level: patient.truthLevel,
      reward,
      order: index + 1,
      scored: patient.truthLevel != null,
      source: patient.source,
      chief_complaint: patient.chiefComplaint,
    } satisfies PerPatientAssignment;
  });

  const score = scoreAssignments(assignments);
  const now = Date.now();
  const startedAt = new Date(now).toISOString();
  const endedAt = new Date(now + Math.max(1, assignments.length) * 250).toISOString();
  const taskId = `${request.taskId}-n${request.batchSize}${extraPatient ? "-extra" : ""}-saved`;
  const episodeId = `saved-${safeEpisodePart(taskId)}-${now.toString(36)}`;

  const trajectory: Array<Record<string, unknown>> = [
    {
      turn: 1,
      kind: "tool_result",
      tool: "load_saved_response",
      text: `Loaded ${patients.length} patient${patients.length === 1 ? "" : "s"} from a saved demo response for ${request.taskId}.`,
      reward: 0,
      finished: false,
      ts: startedAt,
    },
    {
      turn: 2,
      kind: "tool_result",
      tool: "prioritise_queue",
      text: "Sorted patients by highest acuity first, matching the live triage environment scoring rule.",
      reward: 0,
      finished: false,
      ts: new Date(now + 100).toISOString(),
    },
    ...assignments.map((assignment, index) => {
      const isLast = index === assignments.length - 1;
      const remaining = assignments.length - index - 1;
      return {
        turn: index + 3,
        kind: "tool_result",
        tool: ktasTool(assignment.agent_level),
        text: isLast
          ? savedResponseFinalText(assignments, score)
          : `Assigned ${assignment.patient_id} -> KTAS ${assignment.agent_level} (${KTAS_NAMES[assignment.agent_level]}). ${remaining} patient${remaining === 1 ? "" : "s"} remaining.${assignment.scored ? "" : " (unscored — manual entry)"}`,
        reward: isLast ? (score.compositeScore ?? 0) : (assignment.reward ?? 0),
        finished: isLast,
        ts: new Date(now + (index + 2) * 250).toISOString(),
      } satisfies Record<string, unknown>;
    }),
  ];

  let cumulative = 0;
  const rewards = trajectory
    .filter((event) => typeof event.reward === "number")
    .map((event) => {
      const reward = Number(event.reward);
      cumulative += reward;
      return {
        turn: event.turn,
        tool: event.tool,
        reward,
        cumulative,
      };
    });
  const scoredCount = assignments.filter((assignment) => assignment.scored).length;
  const manualCount = assignments.length - scoredCount;
  const result = {
    episode_id: episodeId,
    task_id: taskId,
    model: "saved-responses-demo",
    turns: trajectory.length,
    finished: true,
    status: "complete",
    total_reward: cumulative,
    composite_score: score.compositeScore,
    score: score.compositeScore ?? 0,
    summary: `Saved demo response classified ${assignments.length} patient${assignments.length === 1 ? "" : "s"} instantly.`,
    operator_note: "Saved responses enabled; skipped the live LLM and OpenReward server loop for demo use.",
    cost_usd: 0,
    cost_gbp: 0,
    calls: 0,
    by_model: {},
    started_at: startedAt,
    ended_at: endedAt,
    max_turns: assignments.length,
    scored_count: scoredCount,
    manual_count: manualCount,
    per_patient_assignments: assignments,
    evaluation_summary: evaluationSummary(assignments),
    saved_response: true,
  } satisfies Record<string, unknown>;
  const meta = {
    mode: "saved-responses",
    request: {
      taskId: request.taskId,
      batchSize: request.batchSize,
      extraPatient: extraPatient ?? null,
    },
    generated_at: startedAt,
  } satisfies Record<string, unknown>;

  const dir = path.join(RUNS_DIR, episodeId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  writeJsonlFile(path.join(dir, "trajectory.jsonl"), trajectory);
  writeJsonlFile(path.join(dir, "rewards.jsonl"), rewards);

  return { episodeId };
}

function manualPatientToPython(p: ManualPatient): Record<string, unknown> {
  // The Python `synthesize_manual_patient` reads snake_case fields. Map TS
  // camelCase ↔ Python snake_case here.
  const out: Record<string, unknown> = {
    chief_complaint: p.chiefComplaint,
  };
  if (p.age != null) out.age = p.age;
  if (p.sex != null) out.sex = p.sex;
  if (p.mentalState != null) out.mental_state = p.mentalState;
  if (p.nrsPain != null) out.nrs_pain = p.nrsPain;
  if (p.expectedKtas != null) out.expected_ktas = p.expectedKtas;
  if (p.vitals && typeof p.vitals === "object") {
    const v = p.vitals;
    const vitals: Record<string, number> = {};
    if (v.hr != null) vitals.hr = v.hr;
    if (v.sbp != null) vitals.sbp = v.sbp;
    if (v.dbp != null) vitals.dbp = v.dbp;
    if (v.rr != null) vitals.rr = v.rr;
    if (v.spo2 != null) vitals.spo2 = v.spo2;
    if (v.tempC != null) vitals.temp_c = v.tempC;
    if (Object.keys(vitals).length > 0) out.vitals = vitals;
  }
  return out;
}

function buildAdHocSpec(req: RunRequest): {
  spec: Record<string, unknown>;
  taskId: string;
} {
  if (req.mode === "test") {
    // Look up the task by id, override row_indices for the chosen batchSize.
    const allTasks = fetchTasksJson();
    const base = allTasks.find((t) => t.id === req.taskId);
    if (!base) throw new Error(`unknown taskId: ${req.taskId}`);
    const spec: Record<string, unknown> = {
      ...base,
      n: req.batchSize,
      // Drop the cached row_indices — env will recompute via select_diverse_batch.
      row_indices: undefined,
      max_turns: 50,
    };
    if (req.extraPatient && req.extraPatient.trim().length > 0) {
      spec.manual_patients = [
        manualPatientToPython({ chiefComplaint: req.extraPatient.trim() }),
      ];
    }
    // The env's _build_world picks new row_indices from seed+n. Pass the
    // resolved indices anyway so preview / run agree byte-for-byte.
    spec.id = `${base.id}-n${req.batchSize}${req.extraPatient ? "-extra" : ""}`;
    spec.row_indices = []; // force env to use seed+n path
    return { spec, taskId: String(spec.id) };
  }
  if (req.mode === "manual-single") {
    const spec: Record<string, unknown> = {
      id: `manual-single-${Date.now().toString(36)}`,
      row_indices: [],
      manual_patients: [manualPatientToPython(req.patient)],
      max_turns: 20,
      shift_length_min: 60,
      seed: 0,
      n: 0,
    };
    return { spec, taskId: String(spec.id) };
  }
  // manual-multi
  const cleaned = req.patients
    .filter((p) => p.chiefComplaint.trim().length > 0)
    .slice(0, 8);
  if (cleaned.length === 0) {
    throw new Error("manual-multi requires at least one patient with a chief complaint");
  }
  const spec: Record<string, unknown> = {
    id: `manual-multi-${cleaned.length}-${Date.now().toString(36)}`,
    row_indices: [],
    manual_patients: cleaned.map(manualPatientToPython),
    max_turns: Math.max(20, cleaned.length * 5),
    shift_length_min: 60,
    seed: 0,
    n: 0,
  };
  return { spec, taskId: String(spec.id) };
}

function writeTempSpec(spec: Record<string, unknown>): string {
  const tempPath = path.join(
    os.tmpdir(),
    `triage-task-${crypto.randomBytes(6).toString("hex")}.json`,
  );
  fs.writeFileSync(tempPath, JSON.stringify(spec, null, 2));
  return tempPath;
}

export async function runLiveEpisode(
  request: RunRequest,
): Promise<{ episodeId: string }> {
  if (request.mode === "test" && request.savedResponses) {
    return createSavedResponseEpisode(request);
  }

  await ensureEnvServer();
  configuredAgentModel();

  const before = new Set(
    fs.existsSync(RUNS_DIR)
      ? fs
          .readdirSync(RUNS_DIR, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : [],
  );

  const { spec } = buildAdHocSpec(request);
  const tempPath = writeTempSpec(spec);

  try {
    const args = [
      "run",
      "python",
      "-m",
      "triage_nurse.harness",
      "--task-spec-file",
      tempPath,
      "--max-turns",
      String(spec.max_turns ?? 50),
    ];
    const child = spawn(UV_BIN, args, {
      cwd: TRIAGE_NURSE_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));

    const exitCode: number = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });

    if (exitCode !== 0) {
      throw new Error(
        `triage harness failed (exit ${exitCode}): ${
          Buffer.concat(stderr).toString("utf-8") ||
          Buffer.concat(stdout).toString("utf-8")
        }`,
      );
    }

    const after = fs
      .readdirSync(RUNS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const created = after.find((name) => !before.has(name));

    if (!created) {
      const match = Buffer.concat(stdout)
        .toString("utf-8")
        .match(/\[harness\]\s+([^\s]+)\s+status=/);
      if (match?.[1]) return { episodeId: match[1] };
      throw new Error("could not determine created episode id");
    }
    return { episodeId: created };
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore — best-effort cleanup
    }
  }
}
