import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import type { IntakeSuggestion, LiveTaskOption } from "@/lib/triage/types";

const ROOT = process.cwd();
const TRIAGE_NURSE_DIR = path.join(ROOT, "triage-nurse");
const CASES_DIR = path.join(TRIAGE_NURSE_DIR, "cases");
const RUNS_DIR = path.join(TRIAGE_NURSE_DIR, "runs");
const DATASET_CSV = path.join(ROOT, "dataset", "emergency-triage.csv");
const UV_BIN = "/home/waseef/.local/bin/uv";
const ENV_URL = "http://127.0.0.1:8080";
const ENV_PING_TIMEOUT_MS = 1500;
const ENV_BOOT_TIMEOUT_MS = 10000;
const ENV_START_LOG = path.join("/tmp", "triage-nurse-env-next.log");
const APP_MAX_TURNS = 24;

type CaseFile = {
  id: string;
  name: string;
  presenting_complaint: string;
  narrative_role: string;
  expected_disposition?: string;
  true_diagnosis?: string;
};

type DatasetRow = {
  chiefComplaint: string;
  diagnosis: string;
  disposition: string;
  taskId: string;
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

function readJsonFile(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
}

function makeEpisodeId(taskId: string, model: string): string {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const short = Math.random().toString(16).slice(2, 8).padEnd(6, "0");
  const safeModel = model.replaceAll("/", "-");
  return `${taskId}__${safeModel}__${ts}-${short}`;
}

function readJsonlFile(filePath: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normaliseText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function parseCsvLine(line: string): string[] {
  return line.split(";");
}

function mapDisposition(code: string): string {
  return (
    {
      "1": "discharge",
      "2": "admit",
      "3": "admit",
      "4": "discharge",
      "5": "transfer",
      "6": "deceased",
      "7": "admit",
    }[code] ?? "review"
  );
}

let datasetCache: DatasetRow[] | null = null;

function loadDatasetRows(): DatasetRow[] {
  if (datasetCache) return datasetCache;
  if (!fs.existsSync(DATASET_CSV)) return [];

  const raw = fs.readFileSync(DATASET_CSV, "latin1");
  const [headerLine, ...lines] = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = parseCsvLine(headerLine);
  const chiefIndex = headers.indexOf("Chief_complain");
  const diagnosisIndex = headers.indexOf("Diagnosis in ED");
  const dispositionIndex = headers.indexOf("Disposition");

  const taskIds = listLiveTasks().map((task) => task.id);

  datasetCache = lines.map((line, index) => {
    const cols = parseCsvLine(line);
    return {
      chiefComplaint: cols[chiefIndex] ?? "",
      diagnosis: cols[diagnosisIndex] ?? "",
      disposition: mapDisposition(cols[dispositionIndex] ?? ""),
      taskId: taskIds[index % taskIds.length] ?? "demo-shift",
    } satisfies DatasetRow;
  });

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

async function isEnvReady(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENV_PING_TIMEOUT_MS);
  try {
    const res = await fetch(`${ENV_URL}/health`, {
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

export function listLiveTasks(): LiveTaskOption[] {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs
    .readdirSync(CASES_DIR)
    .filter((name) => name.endsWith(".json") && name !== "demo_shift.json")
    .sort()
    .map((name) => {
      const fullPath = path.join(CASES_DIR, name);
      const file = JSON.parse(fs.readFileSync(fullPath, "utf-8")) as CaseFile;
      const publicLabel = file.true_diagnosis ?? file.presenting_complaint;
      return {
        id: file.id,
        name: file.name,
        label: publicLabel,
        hint: file.presenting_complaint,
        narrativeRole: file.narrative_role,
        presentingComplaint: file.presenting_complaint,
        expectedDisposition: file.expected_disposition ?? "admit",
      } satisfies LiveTaskOption;
    });
}

export function suggestCasesFromIntake(input: string): IntakeSuggestion[] {
  const query = input.trim();
  if (!query) return [];

  const tasksById = new Map(listLiveTasks().map((task) => [task.id, task]));
  return loadDatasetRows()
    .map((row) => {
      const complaintScore = overlapScore(query, row.chiefComplaint);
      const diagnosisScore = overlapScore(query, row.diagnosis);
      const score = Math.max(complaintScore, diagnosisScore * 0.9);
      const task = tasksById.get(row.taskId);
      return {
        taskId: row.taskId,
        caseLabel: task?.label ?? row.taskId,
        complaint: row.chiefComplaint || "Unknown complaint",
        diagnosis: row.diagnosis || "Unknown diagnosis",
        disposition: row.disposition,
        score,
      } satisfies IntakeSuggestion;
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
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
        score:
          typeof result?.score === "number"
            ? result.score
            : typeof result?.total_reward === "number"
              ? result.total_reward
              : null,
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

export async function runLiveEpisode(
  taskId: string,
  operatorNote?: string,
): Promise<{ episodeId: string }> {
  await ensureEnvServer();

  const episodeId = makeEpisodeId(taskId, "gpt-5-mini");
  const episodeDir = path.join(RUNS_DIR, episodeId);
  fs.mkdirSync(episodeDir, { recursive: true });
  fs.writeFileSync(
    path.join(episodeDir, "meta.json"),
    JSON.stringify(
      {
        episode_id: episodeId,
        status: "running",
        task_id: taskId,
        selected_case: taskId,
        operator_note: operatorNote?.trim() ?? null,
        started_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(episodeDir, "trajectory.jsonl"),
    `${JSON.stringify({
      turn: 0,
      type: "queued",
      task_id: taskId,
      selected_case: taskId,
      text: "App requested a live single-case run and is waiting for the harness to start.",
      ts: new Date().toISOString(),
    })}\n`,
  );

  const args = [
    "run",
    "python",
    "-m",
    "triage_nurse.harness",
    "--split",
    "app",
    "--task",
    taskId,
    "--max-turns",
    String(APP_MAX_TURNS),
    "--episode-id",
    episodeId,
  ];
  const child = spawn(UV_BIN, args, {
    cwd: TRIAGE_NURSE_DIR,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      TRIAGE_SELECTED_CASE: taskId,
      TRIAGE_OPERATOR_NOTE: operatorNote?.trim() ?? "",
    },
  });
  child.unref();

  return { episodeId };
}
