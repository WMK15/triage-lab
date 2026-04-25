# Triage Dataset

**File:** `emergency-triage.csv`
**Rows:** 1,267 | **Columns:** 24 | **Delimiter:** semicolon (`;`) | **Encoding:** latin-1

Cross-sectional retrospective study of adult patient records from two South Korean emergency departments, October 2016 – September 2017. The expert-verified KTAS level (`KTAS_expert`) is the ground-truth prediction target. Any mismatch between `KTAS_RN` and `KTAS_expert` is a mistriage.

---

## Column Metadata

### `Group`
**What it is:** Which of the two emergency departments the patient attended.
**Type:** Categorical
**Missing:** 0
**Values:**
- `1` = Local ED (3rd degree, ~40,000 visits/year)
- `2` = Regional ED (4th degree, ~45,000 visits/year)

---

### `Sex`
**What it is:** Biological sex of the patient.
**Type:** Categorical
**Missing:** 0
**Values:**
- `1` = Female
- `2` = Male

---

### `Age`
**What it is:** Age of the patient in years at time of visit.
**Type:** Numeric
**Missing:** 0
**Range:** 16 – 96 | **Mean:** 54.4 | **Median:** 57

---

### `Patients number per hour`
**What it is:** Number of patients arriving at the ED per hour at the time this patient was triaged. Used to assess whether ED crowding affects triage accuracy.
**Type:** Numeric
**Missing:** 0
**Range:** 1 – 17 | **Mean:** 7.5 | **Median:** 7

---

### `Arrival mode`
**What it is:** How the patient got to the ED.
**Type:** Categorical
**Missing:** 0
**Values:**
- `1` = Walking (self-presented)
- `2` = Public ambulance
- `3` = Private vehicle
- `4` = Private ambulance
- `5`, `6`, `7` = Other

---

### `Injury`
**What it is:** Whether the reason for the ED visit was injury-related (e.g. trauma, burns, fractures) or non-injury (e.g. illness, chronic condition).
**Type:** Categorical
**Missing:** 0
**Values:**
- `1` = No (non-injury visit, ~80.7% of records)
- `2` = Yes (injury visit)

---

### `Chief_complain`
**What it is:** The patient's presenting complaint as recorded by the triage nurse — the primary symptom or reason for visiting.
**Type:** Free text (Korean)
**Missing:** 0 (but 5 rows contain `??` encoding corruption)
**Notes:** 417 unique values. **Data Quality Alert:** 🟡 **MODERATE** — 5 rows (~0.4% of data) appear as garbled characters (`??`) due to Korean text being stored in a latin-1 file. Additional encoding/truncation possible in long descriptions. **Recommendation:** (1) Re-encode file as UTF-8 to recover Korean text, or (2) use `Diagnosis in ED` as English-language alternative, or (3) exclude Chief_complain from feature engineering if encoding is unrecoverable.

---

### `Mental`
**What it is:** The patient's level of consciousness/responsiveness on arrival, assessed by the triage nurse using the AVPU scale.
**Type:** Categorical (ordinal — higher = less responsive)
**Missing:** 0
**Values:**
- `1` = Alert (fully conscious, ~93.7% of records)
- `2` = Verbal response (responds to voice)
- `3` = Pain response (responds only to pain stimulus)
- `4` = Unresponsive

---

### `Pain`
**What it is:** Whether the patient reported experiencing pain at triage.
**Type:** Categorical (binary)
**Missing:** 0
**Values:**
- `0` = No pain
- `1` = Pain present (~56.4% of records)

---

### `NRS_pain`
**What it is:** Nurse-assessed pain intensity using the Numeric Rating Scale — a patient self-reported 11-point scale.
**Type:** Numeric (integer 0–10)
**Missing:** 556 rows (~43.9% of data)
**Values:** 1–10 (only patients with `Pain = 1` have a meaningful score); empty/NaN for corrupted entries
**Data Quality Alert:** 🔴 **CRITICAL** — 556 rows (~43.9% of data) had corrupt value `#BOÞ!` (encoding error) in original dataset. **CLEANED:** All corrupted #BOÞ! values converted to empty strings (NaN) in cleaned dataset. Original documentation stated only 1 corrupt value; actual count is 556x higher. **Recommendation for training:** Either (1) exclude NRS_pain feature entirely and use binary `Pain` column (0/1) as proxy instead, or (2) impute missing NRS_pain using clinical context + Pain + vital signs.

---

### `SBP`
**What it is:** Systolic blood pressure — the pressure in arteries when the heart beats (top number in a blood pressure reading).
**Type:** Numeric (mmHg)
**Missing:** 0

---

### `DBP`
**What it is:** Diastolic blood pressure — the pressure in arteries between heartbeats (bottom number in a blood pressure reading).
**Type:** Numeric (mmHg)
**Missing:** 0

---

### `HR`
**What it is:** Heart rate — number of heartbeats per minute.
**Type:** Numeric (beats per minute)
**Missing:** 0

---

### `RR`
**What it is:** Respiratory rate — number of breaths per minute. A key vital sign for detecting respiratory distress.
**Type:** Numeric (breaths per minute)
**Missing:** 0 recorded, but **22 corrupt entries** (??）
**Observed values:** 12–32 breaths/min, appear recorded in even increments (suggesting estimation rather than precise measurement)
**Data Quality Alert:** 🟠 **MAJOR** — 22 rows (~1.7% of data) contain corrupt value `??`. Original documentation stated only 1 corrupt value; actual count is 22x higher. Additional ~20-29 rows show `??` in related vital sign columns (SBP, DBP, HR, BT, Saturation), suggesting broader encoding issue. **Recommendation:** Treat as NaN and impute using vital sign patterns + age/clinical context, or exclude rows.

---

### `BT`
**What it is:** Body temperature in degrees Celsius.
**Type:** Numeric (°C)
**Missing:** 0
**Range:** 35.0 – 38.9°C

---

### `Saturation`
**What it is:** Oxygen saturation (SpO2) — the percentage of haemoglobin in the blood carrying oxygen, measured by pulse oximeter. Normal is ≥95%.
**Type:** Numeric (%)
**Missing:** **688 (~54.3% of records)** — only recorded at the regional ED
**Observed range:** 20–100% (includes 9 rows with `??` encoding errors)
**Data Quality Alert:** 🔴 **CRITICAL** — More than half of oxygen saturation values absent, making reliable predictive modeling difficult. Additional 9 rows contain `??` encoding errors. SpO2 is a critical vital sign for determining acuity (especially for respiratory presentations). **Recommendation:** (1) Exclude Saturation from model features if using only this dataset, (2) Impute using vital sign patterns + age/diagnosis, or (3) Use facility-stratified approach (assume missing = captured only at regional ED).

---

### `KTAS_RN`
**What it is:** The triage level assigned by the emergency nurse using the KTAS algorithm. This is what the nurse actually decided at the time.
**Type:** Categorical (ordinal — lower = more urgent)
**Missing:** 0
**Values:**
- `1` = Resuscitation (immediate)
- `2` = Emergent (within 10 minutes)
- `3` = Urgent (within 30 minutes)
- `4` = Less urgent (within 60 minutes)
- `5` = Non-urgent (within 120 minutes)

Grouped: `1–3` = Emergency | `4–5` = Non-emergency

---

### `Diagnosis in ED`
**What it is:** The final clinical diagnosis made by the ED doctor after full assessment.
**Type:** Free text (English)
**Missing:** 2
**Notes:** 583 unique diagnoses. Recorded after full examination — not available at the point of triage, so should not be used as a triage input feature.

---

### `Disposition`
**What it is:** What happened to the patient after ED treatment — their outcome/discharge destination.
**Type:** Categorical
**Missing:** 0
**Values:**
- `1` = Discharge (~65% of records)
- `2` = Admission to ward
- `3` = Admission to ICU
- `4` = Discharge against medical advice (AMA)
- `5` = Transfer to another facility
- `6` = Death
- `7` = Surgery

---

### `KTAS_expert`
**What it is:** The true KTAS triage level determined retrospectively by a panel of three expert triage nurses reviewing the full medical record. This is the **ground-truth label** for model training.
**Type:** Categorical (ordinal)
**Missing:** 0
**Values:** Same as `KTAS_RN` (1–5)

Grouped: `1–3` = Emergency | `4–5` = Non-emergency

---

### `Error_group`
**What it is:** The categorised cause of the triage error, as identified by the expert panel. Only populated when `mistriage ≠ 0`.
**Type:** Categorical
**Missing:** 0 (uses `0` to indicate no error)
**Values:**
- `0` = No error
- `1` = Incorrect application of pain scale
- `2` = Misjudgement of physical symptoms related to chief complaint
- `3` = Incorrect application of vital signs
- `4` = Incorrect psychological/mental state assessment
- `5` = Incorrect consideration of symptom onset
- `6` = Incorrect consideration of transfer notes
- `7` = Incorrect consideration of underlying disease
- `8` = Other
- `9` = Other

---

### `Length of stay_min`
**What it is:** Total time the patient spent in the ED, from arrival to departure, in minutes.
**Type:** Numeric (minutes)
**Missing:** 0
**Range:** 0 – 709,510 | **Median:** 274 min (~4.6 hours)
**Data Quality Alert:** 🔴 **CRITICAL** — 191 rows (~15.1% of data) contain physiologically impossible extreme outliers (> 2,029 minutes ≈ 33.8 hours). Maximum value is 709,510 minutes (~492 days), indicating data entry errors. Examples: 700,875 min (11,681 hours), 700,536 min (11,676 hours). **Root cause likely:** (1) Concatenated values, (2) Multiplied by wrong factor, or (3) System logging error. **Recommendation:** (1) Cap values at physiologically plausible maximum (e.g., 24–48 hours), (2) Exclude outliers (> 2,029 min) from analysis, or (3) Investigate source system for data entry errors.

---

### `KTAS duration_min`
**What it is:** The time the triage nurse spent completing the KTAS assessment, in minutes.
**Type:** Numeric (minutes)
**Missing:** 0
**Range:** 1.0 – 17.4 | **Mean:** 5.5 | **Median:** 4.3
**Notes:** Uses a comma as the decimal separator (e.g. `5,00`) — replace comma with period and cast to float before use.

---

### `mistriage`
**What it is:** Whether the nurse's triage level (`KTAS_RN`) disagreed with the expert's true level (`KTAS_expert`), and in which direction.
**Type:** Categorical
**Missing:** 0
**Values:**
- `0` = Correct triage (85.3% of records)
- `1` = Over-triage — nurse assigned a higher urgency level than warranted (overestimated severity)
- `2` = Under-triage — nurse assigned a lower urgency level than warranted (underestimated severity, the more dangerous error)

---

## Data Quality Summary

**AUDIT DATE:** 2026-04-25 | **AUDIT TOOL:** `audit_emergency_triage.py` | **TOTAL ROWS AUDITED:** 1,267

### Critical Issues (Must Address Before Use)

| Issue | Column | Count | % Data | Severity | Action |
|-------|--------|-------|--------|----------|--------|
| **Corrupt value (#BOÞ!)** | `NRS_pain` | 556 | 43.9% | 🔴 CRITICAL | Either (1) exclude NRS_pain entirely and use binary `Pain` as proxy, (2) impute from `Pain` + clinical context, or (3) remove affected rows. Original README documented only 1; actual count is 556x higher |
| **Extreme outliers** | `Length of stay_min` | 191 | 15.1% | 🔴 CRITICAL | Cap at physiologically plausible maximum (e.g., 24–48 hours) or exclude outliers > 2,029 min. Max value 709,510 min (~492 days) indicates data entry errors |
| **Missing data** | `Saturation` | 688 | 54.3% | 🔴 CRITICAL | > 50% missing SpO2 data severely limits predictive modeling. Recommend: (1) exclude from features, (2) impute using vital sign patterns, or (3) use facility-stratified approach |

### Major Issues (Requires Handling)

| Issue | Column | Count | % Data | Severity | Action |
|-------|--------|-------|--------|----------|--------|
| **Corrupt values (??)** | `RR` | 22 | 1.7% | 🟠 MAJOR | Treat as NaN and impute, or exclude rows. Original README documented only 1; actual count is 22x higher |
| **Encoding corruption (??)** | Multiple vital signs | ~20-29 | 1.5-2.3% | 🟠 MAJOR | SBP, DBP, HR, BT, Saturation columns each have scattered `??` values indicating broader encoding issue. Clean systematically |
| **Encoding corruption (??)** | `Chief_complain` | 5 | 0.4% | 🟡 MODERATE | Korean text garbling in 5 rows. Re-encode as UTF-8 or use `Diagnosis in ED` as English alternative |

### Formatting Issues (Data Handling Required)

| Issue | Column | Count | Severity | Action |
|-------|--------|-------|----------|--------|
| **Decimal separator is COMMA** | `KTAS duration_min` | 1,267 | 🟡 MODERATE | ALL rows use comma (e.g., "5,00" not "5.00"). Convert: `value.replace(',', '.')` before float conversion |
| **Missing entries** | `Diagnosis in ED` | 2 | 🟢 MINOR | Only 2 missing; negligible impact |

### Summary Statistics

- **Total records:** 1,267
- **Total columns:** 24
- **Records with ANY data quality issue:** ~1,271 (100%+ — some rows have multiple issues)
- **Most affected column:** `NRS_pain` (556 corruptions = 43.9%)
- **Least affected column:** `Age`, `Sex`, `KTAS_RN`, `KTAS_expert`, `mistriage` (all clean)

### Comparison to Original Documentation

Original README understated data quality issues significantly:

| Column | Original Claim | Actual Audit Finding | Discrepancy |
|--------|---|---|---|
| `NRS_pain` | "1 corrupt entry" | 556 corrupt entries | **556x underestimated** |
| `RR` | "1 corrupt entry" | 22 corrupt entries | **22x underestimated** |
| `Saturation` | "54% missing" | 688 rows missing (54.3%) | ✓ Accurate |
| Other vital signs | Not mentioned | ~20-29 rows with `??` each | **Previously undetected** |

**Conclusion:** Original data quality assessment was severely incomplete. This dataset requires substantial cleaning and validation before use in production models.
