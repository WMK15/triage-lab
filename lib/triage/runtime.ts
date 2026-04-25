import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import type { IntakeSuggestion, LiveTaskOption } from "@/lib/triage/types";

const ROOT = process.cwd();
const TRIAGE_NURSE_DIR = path.join(ROOT, "triage-nurse");
const RUNS_DIR = path.join(TRIAGE_NURSE_DIR, "runs");
const DATASET_CSV = path.join(ROOT, "dataset", "emergency-triage.csv");
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normaliseText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function parseCsvLine(line: string): string[] {
  return line.split(";");
}

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

function loadDatasetRows(): DatasetRow[] {
  if (datasetCache) return datasetCache;
  if (!fs.existsSync(DATASET_CSV)) return [];

  const raw = fs.readFileSync(DATASET_CSV, "latin1");
  const [headerLine, ...lines] = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = parseCsvLine(headerLine);
  const chiefIndex = headers.indexOf("Chief_complain");
  const diagnosisIndex = headers.indexOf("Diagnosis in ED");

  const taskIds = listLiveTasks().map((task) => task.id);
  if (taskIds.length === 0) {
    datasetCache = [];
    return datasetCache;
  }

  datasetCache = lines.map((line, index) => {
    const cols = parseCsvLine(line);
    return {
      chiefComplaint: cols[chiefIndex] ?? "",
      diagnosis: cols[diagnosisIndex] ?? "",
      taskId: taskIds[index % taskIds.length],
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
        disposition: "classify",
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

export async function runLiveEpisode(
  taskId: string,
  operatorNote?: string,
): Promise<{ episodeId: string }> {
  await ensureEnvServer();

  const before = new Set(
    fs.existsSync(RUNS_DIR)
      ? fs
          .readdirSync(RUNS_DIR, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : [],
  );

  // Pass the actual selected taskId (v1 hardcoded "demo-shift-001"; v2 batches
  // are e.g. batch-seed42).
  const args = [
    "run",
    "python",
    "-m",
    "triage_nurse.harness",
    "--task",
    taskId,
    "--max-turns",
    "50",
  ];
  const child = spawn(UV_BIN, args, {
    cwd: TRIAGE_NURSE_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      TRIAGE_OPERATOR_NOTE: operatorNote?.trim() ?? "",
    },
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
    // Fallback: parse the harness's own success-line for the episode id.
    const match = Buffer.concat(stdout)
      .toString("utf-8")
      .match(/\[harness\]\s+([^\s]+)\s+status=/);
    if (match?.[1]) return { episodeId: match[1] };
    throw new Error("could not determine created episode id");
  }

  return { episodeId: created };
}
