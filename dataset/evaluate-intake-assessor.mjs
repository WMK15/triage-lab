import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const combinedPath = path.join(root, "dataset", "combined-triage-reference.csv");

function parseDelimitedLine(line, delimiter) {
  const values = [];
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

function readRows() {
  const raw = fs.readFileSync(combinedPath, "utf-8");
  const [headerLine, ...lines] = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = parseDelimitedLine(headerLine, ",");
  return lines.map((line) => {
    const cols = parseDelimitedLine(line, ",");
    return Object.fromEntries(headers.map((header, index) => [header, cols[index] ?? ""]));
  });
}

const rows = readRows();

const severityToLevel = {
  critical: 1,
  high: 2,
  moderate: 3,
  low: 4,
};

const { assessIntake } = await import(path.join(root, "lib", "triage", "runtime.ts"));

let exact = 0;
let offByOne = 0;
let severeMisses = 0;
let scored = 0;
const failures = [];

for (const row of rows) {
  const expected = Number.parseInt(row.reference_level, 10);
  if (Number.isNaN(expected) || !row.chief_complaint) continue;

  const result = await assessIntake([row.chief_complaint]);
  if (result.kind !== "decision") continue;
  const predicted = severityToLevel[result.decision.severity];
  scored += 1;

  const delta = Math.abs(predicted - expected);
  if (delta === 0) exact += 1;
  if (delta === 1) offByOne += 1;
  if (expected <= 2 && predicted >= 4) {
    severeMisses += 1;
    if (failures.length < 15) {
      failures.push({
        complaint: row.chief_complaint,
        diagnosis: row.diagnosis,
        expected,
        predicted,
        severity: result.decision.severity,
        headline: result.decision.headline,
      });
    }
  }
}

console.log(
  JSON.stringify(
    {
      combinedRows: rows.length,
      scored,
      exactRate: scored === 0 ? 0 : Number((exact / scored).toFixed(4)),
      offByOneRate: scored === 0 ? 0 : Number((offByOne / scored).toFixed(4)),
      severeMisses,
      sampleFailures: failures,
    },
    null,
    2,
  ),
);
