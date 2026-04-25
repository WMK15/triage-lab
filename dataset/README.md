# Dataset Folder

This folder contains all local datasets, derived reference files, and supporting research notes used by Triage Lab.

There are no nested dataset subfolders. All dataset CSVs and markdown notes live at the root of `dataset/`.

## Primary files

These are the files the app and backend rely on directly:

- `combined-triage-reference.csv` — unified reference corpus used by the app and preferred by the backend when available
- `emergency-triage-cleaned.csv` — cleaned KTAS source dataset used as a legacy fallback and source input for the combined reference build
- `symptom-triage-reference.csv` — symptom-to-acuity reference table used during intake matching and combined reference construction
- `mimic-iv-ed-triage.csv` — MIMIC-IV-ED triage sample used as one input to the combined reference corpus
- `mimic-iv-ed-diagnosis.csv` — MIMIC-IV-ED diagnosis sample used to enrich the combined reference corpus
- `mimic-iv-ed-edstays.csv` — MIMIC-IV-ED stay metadata used to enrich the combined reference corpus

## Supporting files

- `emergency-triage.csv` — original raw KTAS dataset
- `mimic-iv-ed-vitalsign.csv` — supporting MIMIC-IV-ED vitals sample
- `mimic-iv-ed-medrecon.csv` — supporting MIMIC-IV-ED medication reconciliation sample
- `mimic-iv-ed-pyxis.csv` — supporting MIMIC-IV-ED medication dispense sample
- `mimic-iv-ed-demo.md` — documentation for the MIMIC-IV-ED demo files
- `symptom-acuity-mapping.md` — symptom severity mapping notes
- `triage-assessment-questions.md` — structured intake questioning notes
- `triage-research-findings.md` — research summary and modeling notes
- `build-combined-triage-reference.mjs` — script to rebuild `combined-triage-reference.csv`
- `evaluate-intake-assessor.mjs` — helper script for evaluating the intake assessor

## Runtime usage

Current runtime behavior:

- the Next.js app prefers `combined-triage-reference.csv`
- the backend loader prefers `combined-triage-reference.csv`
- `emergency-triage-cleaned.csv` remains as a fallback and source dataset
- MIMIC-IV-ED CSVs contribute additional complaint and diagnosis coverage when generating the combined reference corpus

## Source notes

### `emergency-triage.csv`

- Rows: 1,267
- Columns: 24
- Delimiter: semicolon (`;`)
- Encoding: latin-1
- Domain: adult emergency department triage records from two South Korean EDs
- Ground-truth label: `KTAS_expert`

Key caveats:

- encoding corruption exists in some complaint and vital-sign fields
- `NRS_pain` has substantial corruption and missingness in the raw source
- `Saturation` has high missingness
- `Length of stay_min` contains major outliers

Use `emergency-triage-cleaned.csv` instead of the raw file for application logic.

### MIMIC-IV-ED demo files

The `mimic-iv-ed-*.csv` files are a deidentified demo subset derived from MIMIC-IV-ED. They are included as supporting reference material and as source inputs for the combined reference dataset.

See `mimic-iv-ed-demo.md` for details on fields, caveats, and provenance.
