import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const datasetDir = path.join(root, "dataset");

const EMERGENCY_TRIAGE_CSV = path.join(datasetDir, "emergency-triage.csv");
const SYMPTOM_REFERENCE_CSV = path.join(datasetDir, "symptom-triage-reference.csv");
const ED_TRIAGE_CSV = path.join(datasetDir, "ed", "triage.csv");
const ED_DIAGNOSIS_CSV = path.join(datasetDir, "ed", "diagnosis.csv");
const ED_STAYS_CSV = path.join(datasetDir, "ed", "edstays.csv");
const OUTPUT_CSV = path.join(datasetDir, "combined-triage-reference.csv");

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

function readDelimitedRows(filePath, delimiter, encoding = "utf-8") {
  const raw = fs.readFileSync(filePath, encoding);
  const [headerLine, ...lines] = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return {
    headers: parseDelimitedLine(headerLine, delimiter),
    rows: lines.map((line) => parseDelimitedLine(line, delimiter)),
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

const diagnosis = readDelimitedRows(ED_DIAGNOSIS_CSV, ",");
const diagnosisStayIndex = diagnosis.headers.indexOf("stay_id");
const diagnosisSeqIndex = diagnosis.headers.indexOf("seq_num");
const diagnosisTitleIndex = diagnosis.headers.indexOf("icd_title");

const primaryDiagnosisByStay = new Map();
for (const row of diagnosis.rows) {
  const stayId = row[diagnosisStayIndex] ?? "";
  const seqNum = Number.parseInt(row[diagnosisSeqIndex] ?? "", 10);
  if (!stayId || seqNum !== 1) continue;
  primaryDiagnosisByStay.set(stayId, row[diagnosisTitleIndex] ?? "");
}

const stays = readDelimitedRows(ED_STAYS_CSV, ",");
const stayIdIndex = stays.headers.indexOf("stay_id");
const dispositionIndex = stays.headers.indexOf("disposition");
const arrivalIndex = stays.headers.indexOf("arrival_transport");

const stayMetaById = new Map();
for (const row of stays.rows) {
  const stayId = row[stayIdIndex] ?? "";
  if (!stayId) continue;
  stayMetaById.set(stayId, {
    disposition: row[dispositionIndex] ?? "",
    arrivalMode: row[arrivalIndex] ?? "",
  });
}

const combinedRows = [];

const emergency = readDelimitedRows(EMERGENCY_TRIAGE_CSV, ";", "latin1");
const emergencyChiefIndex = emergency.headers.indexOf("Chief_complain");
const emergencyDiagnosisIndex = emergency.headers.indexOf("Diagnosis in ED");
const emergencyLevelIndex = emergency.headers.indexOf("KTAS_expert");
const emergencyDispositionIndex = emergency.headers.indexOf("Disposition");
const emergencyArrivalIndex = emergency.headers.indexOf("Arrival mode");
const emergencySexIndex = emergency.headers.indexOf("Sex");
const emergencyAgeIndex = emergency.headers.indexOf("Age");
const emergencyMentalIndex = emergency.headers.indexOf("Mental");
const emergencyPainFlagIndex = emergency.headers.indexOf("Pain");
const emergencyPainScoreIndex = emergency.headers.indexOf("NRS_pain");
const emergencySbpIndex = emergency.headers.indexOf("SBP");
const emergencyDbpIndex = emergency.headers.indexOf("DBP");
const emergencyHrIndex = emergency.headers.indexOf("HR");
const emergencyRrIndex = emergency.headers.indexOf("RR");
const emergencyTempIndex = emergency.headers.indexOf("BT");
const emergencySatIndex = emergency.headers.indexOf("Saturation");

emergency.rows.forEach((row, index) => {
  const level = Number.parseInt(row[emergencyLevelIndex] ?? "", 10);
  combinedRows.push({
    source: "ktas",
    source_id: `ktas-${index + 1}`,
    chief_complaint: row[emergencyChiefIndex] ?? "",
    diagnosis: row[emergencyDiagnosisIndex] ?? "",
    reference_level: Number.isNaN(level) ? "" : String(level),
    high_acuity: !Number.isNaN(level) && level <= 2 ? "yes" : "no",
    disposition: row[emergencyDispositionIndex] ?? "",
    arrival_mode: row[emergencyArrivalIndex] ?? "",
    sex: row[emergencySexIndex] ?? "",
    age: row[emergencyAgeIndex] ?? "",
    mental_state: row[emergencyMentalIndex] ?? "",
    pain_flag: row[emergencyPainFlagIndex] ?? "",
    pain_score: row[emergencyPainScoreIndex] ?? "",
    sbp: row[emergencySbpIndex] ?? "",
    dbp: row[emergencyDbpIndex] ?? "",
    hr: row[emergencyHrIndex] ?? "",
    rr: row[emergencyRrIndex] ?? "",
    temp_c: row[emergencyTempIndex] ?? "",
    spo2: row[emergencySatIndex] ?? "",
  });
});

const symptomReference = readDelimitedRows(SYMPTOM_REFERENCE_CSV, ",");
const symptomNameIndex = symptomReference.headers.indexOf("symptom_name");
const symptomLevelIndex = symptomReference.headers.indexOf("typical_triage_level");
const symptomHighIndex = symptomReference.headers.indexOf("high_acuity_modifier");
const symptomRuleOutIndex = symptomReference.headers.indexOf("must_rule_out");

symptomReference.rows.forEach((row, index) => {
  const level = Number.parseInt(row[symptomLevelIndex] ?? "", 10);
  combinedRows.push({
    source: "symptom_reference",
    source_id: `symptom-${index + 1}`,
    chief_complaint: row[symptomNameIndex] ?? "",
    diagnosis: row[symptomRuleOutIndex] ?? row[symptomNameIndex] ?? "",
    reference_level: Number.isNaN(level) ? "" : String(level),
    high_acuity:
      row[symptomHighIndex]?.toLowerCase() === "yes" || (!Number.isNaN(level) && level <= 2)
        ? "yes"
        : "no",
    disposition: "",
    arrival_mode: "",
    sex: "",
    age: "",
    mental_state: "",
    pain_flag: "",
    pain_score: "",
    sbp: "",
    dbp: "",
    hr: "",
    rr: "",
    temp_c: "",
    spo2: "",
  });
});

const edTriage = readDelimitedRows(ED_TRIAGE_CSV, ",");
const edStayIndex = edTriage.headers.indexOf("stay_id");
const edComplaintIndex = edTriage.headers.indexOf("chiefcomplaint");
const edAcuityIndex = edTriage.headers.indexOf("acuity");
const edTempIndex = edTriage.headers.indexOf("temperature");
const edHrIndex = edTriage.headers.indexOf("heartrate");
const edRrIndex = edTriage.headers.indexOf("resprate");
const edSpo2Index = edTriage.headers.indexOf("o2sat");
const edSbpIndex = edTriage.headers.indexOf("sbp");
const edDbpIndex = edTriage.headers.indexOf("dbp");
const edPainIndex = edTriage.headers.indexOf("pain");

edTriage.rows.forEach((row, index) => {
  const stayId = row[edStayIndex] ?? "";
  const level = Number.parseInt(row[edAcuityIndex] ?? "", 10);
  const meta = stayMetaById.get(stayId) ?? { disposition: "", arrivalMode: "" };
  combinedRows.push({
    source: "ed_triage",
    source_id: `ed-${index + 1}`,
    chief_complaint: row[edComplaintIndex] ?? "",
    diagnosis: primaryDiagnosisByStay.get(stayId) ?? row[edComplaintIndex] ?? "",
    reference_level: Number.isNaN(level) ? "" : String(level),
    high_acuity: !Number.isNaN(level) && level <= 2 ? "yes" : "no",
    disposition: meta.disposition,
    arrival_mode: meta.arrivalMode,
    sex: "",
    age: "",
    mental_state: "",
    pain_flag: row[edPainIndex] ? "1" : "0",
    pain_score: row[edPainIndex] ?? "",
    sbp: row[edSbpIndex] ?? "",
    dbp: row[edDbpIndex] ?? "",
    hr: row[edHrIndex] ?? "",
    rr: row[edRrIndex] ?? "",
    temp_c: row[edTempIndex] ?? "",
    spo2: row[edSpo2Index] ?? "",
  });
});

const filteredRows = combinedRows.filter((row) => row.chief_complaint || row.diagnosis);
const headers = [
  "source",
  "source_id",
  "chief_complaint",
  "diagnosis",
  "reference_level",
  "high_acuity",
  "disposition",
  "arrival_mode",
  "sex",
  "age",
  "mental_state",
  "pain_flag",
  "pain_score",
  "sbp",
  "dbp",
  "hr",
  "rr",
  "temp_c",
  "spo2",
];

const csv = [headers.join(",")]
  .concat(filteredRows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")))
  .join("\n");

fs.writeFileSync(OUTPUT_CSV, `${csv}\n`, "utf-8");
console.log(`Wrote ${filteredRows.length} rows to ${path.relative(root, OUTPUT_CSV)}`);
