# MIMIC-IV-ED Demo Dataset

**Source:** [PhysioNet — MIMIC-IV-ED Demo v2.2](https://www.physionet.org/content/mimic-iv-ed-demo/2.2/)
**Full documentation:** [mimic.mit.edu/docs/iv/modules/ed/](https://mimic.mit.edu/docs/iv/modules/ed/)

A deidentified subset of **100 patients** from the Emergency Department at Beth Israel Deaconess Medical Center (BIDMC), Boston, USA. Data spans 2011–2019. This demo is a small sample of the full MIMIC-IV-ED dataset (425,087+ ED stays) intended for exploration and education.

Dates have been shifted for deidentification — they are internally consistent within a patient but do not reflect real calendar dates.

---

## Files

| File | Rows (demo) | What it contains |
|------|-------------|-----------------|
| `mimic-iv-ed-edstays.csv` | 222 | One row per ED visit — the master tracking table |
| `mimic-iv-ed-triage.csv` | 222 | Vital signs and acuity level recorded at triage |
| `mimic-iv-ed-vitalsign.csv` | 1,038 | Repeated vital sign measurements throughout the stay |
| `mimic-iv-ed-diagnosis.csv` | 545 | ICD-coded diagnoses assigned at discharge |
| `mimic-iv-ed-medrecon.csv` | 2,764 | Medications the patient reported taking on arrival |
| `mimic-iv-ed-pyxis.csv` | 1,082 | Medications dispensed from the ED Pyxis cabinet |

### How the tables link

All tables share `subject_id` (patient) and `stay_id` (single ED visit) as join keys. `mimic-iv-ed-edstays.csv` is the anchor — every other table's `stay_id` references a row there. `hadm_id` links to the broader MIMIC-IV clinical database for patients who were admitted.

```
mimic-iv-ed-edstays ──┬── mimic-iv-ed-triage
                      ├── mimic-iv-ed-vitalsign
                      ├── mimic-iv-ed-diagnosis
                      ├── mimic-iv-ed-medrecon
                      └── mimic-iv-ed-pyxis
```

---

## Table: `mimic-iv-ed-edstays.csv`

One row per ED visit. The master index for all other tables.

| Column | Type | Description |
|--------|------|-------------|
| `subject_id` | Integer | Unique patient identifier. Consistent across all MIMIC-IV tables. |
| `hadm_id` | Integer | Hospital admission ID. Only populated if the patient was admitted from the ED; NULL otherwise. Links to MIMIC-IV clinical database. |
| `stay_id` | Integer | Unique ED stay identifier. Primary join key across all ED tables. |
| `intime` | Timestamp | Date and time the patient arrived and was registered in the ED. |
| `outtime` | Timestamp | Date and time the patient left the ED (discharge, admission, transfer, etc.). |
| `gender` | Text | Administrative gender recorded in the hospital system. Values: `F`, `M`. |
| `race` | Text | Patient's self-reported race/ethnicity. Free-text field with ~33 possible values (e.g. `WHITE`, `BLACK/AFRICAN AMERICAN`, `UNKNOWN`). |
| `arrival_transport` | Text | How the patient arrived at the ED. Values: `WALK IN`, `AMBULANCE`, `OTHER`, `UNKNOWN`. |
| `disposition` | Text | What happened when the patient left the ED. Values: `ADMITTED`, `HOME`, `TRANSFER`, `LEFT WITHOUT BEING SEEN`, `LEFT AGAINST MEDICAL ADVICE`, `ELOPED`, `OTHER`. |

**Missing:** `hadm_id` is null for 50 rows (patients not formally admitted).

---

## Table: `mimic-iv-ed-triage.csv`

One row per ED visit. Vital signs and acuity level recorded by the triage nurse at the start of the visit, before full assessment.

| Column | Type | Description |
|--------|------|-------------|
| `subject_id` | Integer | Unique patient identifier. |
| `stay_id` | Integer | Unique ED stay identifier. |
| `temperature` | Numeric | Body temperature in **degrees Fahrenheit** at triage. Normal ~98.6°F. |
| `heartrate` | Numeric | Heart rate in beats per minute at triage. |
| `resprate` | Numeric | Respiratory rate in breaths per minute at triage. |
| `o2sat` | Numeric | Peripheral oxygen saturation (SpO2) as a percentage at triage. Normal ≥95%. |
| `sbp` | Numeric | Systolic blood pressure in mmHg at triage. |
| `dbp` | Numeric | Diastolic blood pressure in mmHg at triage. |
| `pain` | Text | Patient's self-reported pain level on a 0–10 scale, recorded as free text. May contain non-numeric entries. |
| `acuity` | Integer | **Emergency Severity Index (ESI)** triage priority assigned by the nurse. Scale: `1` (most urgent) to `5` (least urgent). Only levels 1–4 observed in demo. |
| `chiefcomplaint` | Text | Free-text description of the patient's main reason for visiting, as recorded by the triage nurse. 182 unique values in demo. |

**Missing:** All vital sign columns have ~10–12% missingness (~23–26 rows). `acuity` missing in 15 rows. `pain` missing in 21 rows.

**Note:** `acuity` uses the ESI (US standard), not KTAS. Mapping: 1 = Immediate, 2 = Emergent, 3 = Urgent, 4 = Less urgent, 5 = Non-urgent.

---

## Table: `mimic-iv-ed-vitalsign.csv`

Multiple rows per ED visit — repeated vital sign measurements taken throughout the stay (not just at triage). Each row is one measurement snapshot.

| Column | Type | Description |
|--------|------|-------------|
| `subject_id` | Integer | Unique patient identifier. |
| `stay_id` | Integer | Unique ED stay identifier. |
| `charttime` | Timestamp | When this set of vital signs was recorded. Each stay_id may have many rows at different times. |
| `temperature` | Numeric | Body temperature in degrees Fahrenheit. Note: some values may have been entered in Celsius by mistake. |
| `heartrate` | Numeric | Heart rate in beats per minute. |
| `resprate` | Numeric | Respiratory rate in breaths per minute. |
| `o2sat` | Numeric | Oxygen saturation as a percentage. |
| `sbp` | Integer | Systolic blood pressure in mmHg. |
| `dbp` | Integer | Diastolic blood pressure in mmHg. |
| `rhythm` | Text | Heart rhythm as assessed by nursing staff. Values: `Normal Sinus Rhythm`, `Sinus Tachycardia`, `Sinus Bradycardia`, `Sinus Rhythm`, `Atrial Fibrillation`, `Paced Rhythm`, `afib`, `sr`. Very sparse — only recorded in ~3% of rows. |
| `pain` | Text | Self-reported pain score (0–10). Free text — may include entries like `0/10` or non-numeric values. |

**Missing:** `temperature` missing in ~44% of rows. `rhythm` missing in ~97% of rows (rarely recorded). Other vitals 3–6% missing.

---

## Table: `mimic-iv-ed-diagnosis.csv`

One row per diagnosis per ED visit. A single visit typically has multiple diagnoses assigned at discharge.

| Column | Type | Description |
|--------|------|-------------|
| `subject_id` | Integer | Unique patient identifier. |
| `stay_id` | Integer | Unique ED stay identifier. |
| `seq_num` | Integer | Priority order of the diagnosis for this visit. `1` = primary (most clinically significant) diagnosis. Higher numbers are secondary/additional diagnoses. |
| `icd_code` | Text | Diagnosis code from the International Classification of Diseases (ICD). Must be interpreted alongside `icd_version`. 288 unique codes in demo. |
| `icd_version` | Integer | Which ICD coding system was used. Values: `9` (ICD-9) or `10` (ICD-10). The two systems use different codes for the same conditions. |
| `icd_title` | Text | Human-readable description of the ICD code (e.g. `INTRACEREBRAL HEMORRHAGE`, `ABDOMINAL PAIN`). 288 unique titles in demo. |

**Missing:** None.

**Note:** ICD-9 and ICD-10 codes are not directly comparable — always filter by `icd_version` before grouping or comparing codes.

---

## Table: `mimic-iv-ed-medrecon.csv`

Medication reconciliation — medications the patient reported taking at home, recorded by nursing staff on ED admission. Multiple rows per visit (one per medication, potentially with multiple drug class rows per medication).

| Column | Type | Description |
|--------|------|-------------|
| `subject_id` | Integer | Unique patient identifier. |
| `stay_id` | Integer | Unique ED stay identifier. |
| `charttime` | Timestamp | When the medication reconciliation was recorded. |
| `name` | Text | Name of the medication as entered by the nurse. Free text — may include trade names, generics, or abbreviations. 490 unique values in demo. |
| `gsn` | Integer | Generic Sequence Number — a standardised drug ontology code. `0` indicates code not found/available. |
| `ndc` | Integer | National Drug Code — a US drug identifier. `0` indicates code not found/available. |
| `etc_rn` | Integer | Row number for the drug's therapeutic class grouping. A single drug can belong to multiple ETC groups — this number differentiates them (1, 2, 3…). |
| `etccode` | Integer | Enhanced Therapeutic Class (ETC) code — categorises the drug by its therapeutic use (e.g. ACE Inhibitors, Beta Blockers). |
| `etcdescription` | Text | Human-readable description of the ETC group (e.g. `ACE Inhibitors`, `Alpha-Beta Blockers`). 242 unique classes in demo. |

**Missing:** `etccode` and `etcdescription` missing in 4 rows (drug class not found).

---

## Table: `mimic-iv-ed-pyxis.csv`

Medications dispensed from the Pyxis automated cabinet in the ED — i.e. drugs actually given to the patient during their stay. Multiple rows per visit.

| Column | Type | Description |
|--------|------|-------------|
| `subject_id` | Integer | Unique patient identifier. |
| `stay_id` | Integer | Unique ED stay identifier. |
| `charttime` | Timestamp | Time the medication was dispensed from the cabinet, used as a proxy for administration time. |
| `med_rn` | Integer | Row number grouping dispensations for a single medication event. Use to identify when multiple items were dispensed together. |
| `name` | Text | Name of the dispensed medication. 241 unique values in demo. |
| `gsn` | Integer | Generic Sequence Number code for the medication. |
| `gsn_rn` | Integer | Row number for cases where a single medication maps to multiple GSN codes. Values: 1, 2, 3. Ordering has no significance. |

**Missing:** `gsn` missing in 32 rows.

---

## Data Quality Notes

| Issue | Table / Column | Detail |
|-------|---------------|--------|
| Dates are shifted | All `charttime`, `intime`, `outtime` | Deidentified by date-shifting — relative durations within a patient are valid, but absolute dates are not real |
| Temperature may be in wrong unit | `vitalsign.temperature`, `triage.temperature` | Some values may have been entered in Celsius instead of Fahrenheit — validate physiologically implausible values |
| `pain` is free text | `triage.pain`, `vitalsign.pain` | Contains entries like `0/10`, `None`, or blank alongside numeric strings — cast carefully |
| `dbp` outlier | `triage.dbp` | Max value of 879 mmHg is physiologically impossible — treat as erroneous |
| `o2sat` outlier | `vitalsign.o2sat` | Min value of 10% is extremely low — likely erroneous |
| ICD version mixing | `diagnosis.icd_code` | ICD-9 and ICD-10 codes coexist — always filter by `icd_version` |
| Drug codes absent | `medrecon.gsn`, `medrecon.ndc` | Value `0` means code not found, not a real code |
| Demo size | All tables | Only 100 patients (~222 stays) — not representative for training ML models |
