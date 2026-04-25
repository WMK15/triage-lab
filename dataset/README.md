# Triage Dataset

**Source:** Moon S-H, Shim JL, Park K-S, Park C-S (2019). *Triage accuracy and causes of mistriage using the Korean Triage and Acuity Scale.* PLoS ONE 14(9): e0216972.

## Study Background

Cross-sectional retrospective study of **1,267 adult patient records** from two South Korean emergency departments (one regional 4th-degree ED, one local 3rd-degree ED) collected between October 2016 and September 2017.

The true KTAS level (ground truth label) was determined by a panel of three triage experts: a certified emergency nurse, a KTAS provider and instructor, and a senior nurse with extensive ED experience.

---

## Variables

### Demographic

| Column | Description |
|--------|-------------|
| `Sex` | Patient sex |
| `Age` | Patient age (years) |

### Presentation

| Column | Description |
|--------|-------------|
| `Chief_complain` | Patient's presenting complaint |
| `Arrival_mode` | Mode of transport to the ED |
| `Injury` | Whether the visit is injury-related |
| `Mental` | Mental/consciousness state on arrival |
| `Pain` | Whether the patient reports pain |
| `NRS_pain` | Nurse-assessed pain score (Numeric Rating Scale, 0–10) |

### Vital Signs

| Column | Description |
|--------|-------------|
| `SBP` | Systolic blood pressure (mmHg) |
| `DBP` | Diastolic blood pressure (mmHg) |
| `HR` | Heart rate (beats per minute) |
| `RR` | Respiratory rate (breaths per minute) |
| `BT` | Body temperature (°C) |

### Administrative / Outcome

| Column | Description |
|--------|-------------|
| `Group` | Type of ED |
| `Disposition` | Patient outcome after ED visit |
| `KTAS_RN` | Triage level assigned by the emergency nurse |
| `KTAS_expert` | True KTAS level determined by expert panel (ground truth) |

---

## Categorical Encodings

Several columns that appear numeric are actually categorical. Encodings are as follows:

**`Sex`**
- `1` = Female
- `2` = Male

**`Injury`**
- `1` = No
- `2` = Yes

**`Pain`**
- `0` = No
- `1` = Yes

**`Mental`**
- `1` = Alert
- `2` = Verbal response
- `3` = Pain response
- `4` = Unresponsive

**`Group`** (Type of ED)
- `1` = Local ED (3rd degree)
- `2` = Regional ED (4th degree)

**`Arrival_mode`**
- `1` = Walking
- `2` = Public ambulance
- `3` = Private vehicle
- `4` = Private ambulance
- `5`, `6`, `7` = Other

**`Disposition`**
- `1` = Discharge
- `2` = Admission to ward
- `3` = Admission to ICU
- `4` = Discharge (against medical advice)
- `5` = Transfer
- `6` = Death
- `7` = Surgery

**`KTAS_RN` / `KTAS_expert`** (Korean Triage and Acuity Scale)
- `1` = Resuscitation
- `2` = Emergent
- `3` = Urgent
- `4` = Less urgent
- `5` = Non-urgent

Grouped for binary classification:
- `1–3` = Emergency
- `4–5` = Non-emergency

---

## Label Notes

The primary prediction target is `KTAS_expert` (the expert-verified true triage level). `KTAS_RN` is the nurse's assigned level and can be used to study mistriage — any disagreement between `KTAS_RN` and `KTAS_expert` constitutes a mistriage event.

Key finding from the source study: **14.7% of records (n=186)** showed mistriage, with under-triage (nurse underestimated severity) being more common than over-triage (70.4% vs 29.6% of errors). The leading cause was incorrect application of the pain scale.
