# Triage Score & Symptom Research Findings

## Critical Design Principle: Asymmetric Error Tolerance

**Under-triage is the dangerous error. Over-triage is acceptable.**

Under-triage (assigning too low an acuity) delays life-saving treatment and is associated with increased mortality and ICU admission. Over-triage (assigning too high an acuity) wastes resources but does not directly harm the patient.

**Practical implications for modelling:**
- Use asymmetric loss functions: penalise false negatives (missed high-acuity) far more than false positives (unnecessary high-acuity)
- When in doubt between two adjacent levels, **predict the higher acuity**
- Optimise for **high sensitivity / recall on high-acuity classes (L1–L2–L3)** even at the cost of precision
- Set classification thresholds conservatively — lean toward escalation
- Evaluate models on undertriage rate explicitly, not just overall accuracy or AUC
- For elderly patients (≥ 65), apply an additional upward bias — they are systematically undertriaged by standard algorithms

---

## 1. Triage Systems Overview

Five major triage systems are in use worldwide, all using a 5-level scale (1 = most urgent):

| System | Country | Basis for Level Assignment |
|--------|---------|---------------------------|
| ESI (Emergency Severity Index) | USA | Life threat first, then predicted resource use |
| CTAS (Canadian Triage and Acuity Scale) | Canada | Standardised complaint list + clinical modifiers |
| KTAS (Korean Triage and Acuity Scale) | South Korea | Derived from CTAS, GCS-anchored |
| ATS (Australasian Triage Scale) | Australia/NZ | 79 clinical descriptors across physiological domains |
| MTS (Manchester Triage System) | UK/Europe | 52 complaint-specific flowcharts + discriminators |

All systems converge on the same core signals: **oxygenation, haemodynamics, consciousness, and respiratory effort**.

---

## 2. Vital Sign Thresholds by Acuity Level

### 2.1 Consolidated Adult Thresholds

| Vital Sign | Level 1 (Critical) | Level 2 (Emergent) | Level 3 (Urgent) | Level 4–5 (Non-urgent) |
|------------|--------------------|--------------------|------------------|------------------------|
| SpO2 | < 90% | 90–94% | 90–94% with context | ≥ 95% |
| Heart rate | < 40 or > 131 bpm | 40–50 or 110–130 bpm | 50–55 or 100–110 bpm | 50–100 bpm |
| Resp rate | ≤ 8 or ≥ 25 bpm | — | ≥ 20 bpm (ESI danger zone) | 12–20 bpm |
| SBP | ≤ 90 mmHg (shock) | 91–100 mmHg | 100–110 mmHg (borderline) | > 110 mmHg |
| Temperature | < 35°C or > 40°C with systemic signs | > 38.3°C with risk factors | 38.1–40°C stable | 36.1–38°C |
| GCS | 3–8 | 9–13 | 14 (borderline) | 15 |
| Consciousness (AVPU) | Unresponsive / Pain | Voice | — | Alert |

### 2.2 ESI Danger Zone Vital Signs (triggers reassignment from L3 → possible L2)

| Vital Sign | Threshold |
|------------|-----------|
| Heart rate | > 100 bpm or < 50 bpm |
| Respiratory rate | > 20 bpm or < 12 bpm |
| SpO2 | < 92% |
| SBP | < 90 mmHg |
| Temperature | > 38.3°C (101°F) |

### 2.3 NEWS2 Score Reference (widely used composite in UK/European EDs)

| Parameter | Score 3 | Score 2 | Score 1 | Score 0 (normal) |
|-----------|---------|---------|---------|-----------------|
| Resp rate (bpm) | ≤ 8 or ≥ 25 | 9–11 | 21–24 | 12–20 |
| SpO2 | ≤ 91% | 92–93% | 94–95% | ≥ 96% |
| Supplemental O2 | On O2 (+2) | — | — | Room air |
| SBP (mmHg) | ≤ 90 or ≥ 220 | 91–100 | 101–110 | 111–219 |
| Heart rate (bpm) | ≤ 40 or ≥ 131 | 41–50 or 111–130 | 51–90 or 91–110 | 51–90 |
| Temperature (°C) | ≤ 35.0 | ≥ 39.1 | 35.1–36.0 or 38.1–39.0 | 36.1–38.0 |
| Consciousness | New confusion / V / P / U (+3) | — | — | Alert |

**NEWS2 total → escalation:**
- 1–4: Low (12-hourly monitoring)
- Any single parameter = 3: Urgent clinician review
- 5–6: Medium (≥ hourly monitoring)
- ≥ 7: Emergency team required

NEWS2 ≥ 5 has > 88% sensitivity for ICU admission or mortality in sepsis. NEWS2 outperforms qSOFA, SIRS, and SOFA for sepsis detection at ED triage.

### 2.4 Elderly Patients (≥ 65) — Adjusted Thresholds

Standard thresholds underperform in older adults (AUC 0.59–0.62). Adjusted thresholds:

| Level | SBP | HR | Temp | GCS |
|-------|-----|-----|------|-----|
| L1 | < 80 mmHg | < 40 or > 140 | < 35°C | 3–8 |
| L2 | 80–100 mmHg | 40–50 or 120–140 | > 40°C | 9–14 |

Applying age-adjusted thresholds improves AUC from 0.62 → 0.74–0.76 in elderly populations. **Treat any abnormal vital in a patient ≥ 65 more seriously than the same value in a younger patient.**

---

## 3. Symptom-to-Triage-Level Mapping

| Condition / Presentation | L1 | L2 | L3 | L4–5 |
|--------------------------|----|----|----|----|
| Cardiac / respiratory arrest | ✓ | | | |
| SpO2 < 90%, cyanosis | ✓ | | | |
| GCS 3–8 / unresponsive | ✓ | | | |
| Immediate airway intervention needed | ✓ | | | |
| Active ACS-type chest pain | | ✓ | | |
| Stroke symptoms (aphasia, facial droop, limb weakness) | | ✓ | | |
| GCS 9–13 | | ✓ | | |
| Suspected sepsis (fever + infection + organ dysfunction) | | ✓ | | |
| Very severe / acute central pain (NRS ≥ 8) | | ✓ | | |
| Haemodynamic compromise (pale, diaphoretic, postural hypotension) | | ✓ | | |
| Moderate dyspnoea (SpO2 90–94%) | | ✓/✓ | | |
| Infant < 90 days with any fever | | ✓ | | |
| Actively suicidal / homicidal | | ✓ | | |
| Ectopic pregnancy suspected | | ✓ | | |
| Alert head injury (GCS 14–15) | | | ✓ | |
| Moderate respiratory distress, stable SpO2 | | | ✓ | |
| Severe pain with stable vitals | | | ✓ | |
| Fever in adult with normal vitals | | | ✓ | |
| New confusion, not yet L1–2 | | | ✓ | |
| Moderate pain with some risk features | | | | L4 |
| Minor wound, normal vitals | | | | L4–5 |
| Prescription refill, no acute illness | | | | L5 |

---

## 4. Pain Score and Triage

### 4.1 Pain Thresholds by System

| System | L1 | L2 | L3 | L4 | L5 |
|--------|----|----|----|----|-----|
| KTAS/CTAS | — | Central acute, NRS ≥ 8 | NRS 4–7 severe context | NRS 4–7 stable | NRS ≤ 3 |
| ATS | — | Very severe (any cause) | Moderately severe | Moderate + risk features | Minimal |
| MTS | — | Severe (discriminator in 43/52 flowcharts) | Moderate | Mild | None |
| ESI | — | Severe distress (clinical judgement) | Contributes to resource prediction | — | — |

### 4.2 KTAS Pain Thresholds
- NRS ≤ 3: Mild
- NRS 4–7: Moderate
- NRS ≥ 8: Severe

**Critical distinction:** Pain location and character matter as much as the score:
- **Central acute pain** (chest, abdomen, back) at NRS 6 → more urgent than peripheral chronic pain at NRS 9
- KTAS divides pain into: central vs. peripheral, acute vs. chronic, mild vs. moderate vs. severe

### 4.3 Pain-Driven Overtriage — A Known Systematic Problem

A major KTAS study found incorporating pain scores **reduced** predictive accuracy (AUC fell from 0.765 → 0.736). Key findings:
- Patients in the non-pain group had **higher actual odds of requiring emergency procedures** (OR 2.98 vs. 1.52 in pain-driven group)
- NRS pain averages 7.36 at triage vs. observer-rated 5.5 — systematic ~2-point self-inflation
- In Korea specifically: higher KTAS level reduces patient insurance costs — incentivising inflation

**Model design implication:** Include NRS pain score but always interact it with:
- Pain location (central vs. peripheral)
- Pain character (acute vs. chronic onset)
- Vital sign context (if vitals are normal, pain alone should not drive high acuity)

Do **not** use raw pain score as a standalone feature — it will over-triage.

---

## 5. Mental Status / Consciousness

### 5.1 GCS Thresholds

| GCS | KTAS | CTAS | Clinical State |
|-----|------|------|----------------|
| 3–8 | L1 | L1 | Coma / unresponsive |
| 9–13 | L2 | L2 | Severely impaired |
| 14 | L2–3 (borderline) | L3 | Mildly impaired |
| 15 | L3–5 | L3–5 | Alert, oriented |

### 5.2 AVPU Equivalents

| AVPU | Approx GCS | NEWS2 Score |
|------|-----------|-------------|
| Alert | 14–15 | 0 |
| New Confusion | 14 (functionally) | 3 |
| Voice | ~9–13 | 3 |
| Pain | ~5–8 | 3 |
| Unresponsive | 3–4 | 3 |

**Any deviation from Alert scores NEWS2 = 3 (maximum for a single parameter).** New confusion in isolation is a high-priority finding — it is a sensitive early marker of sepsis, metabolic derangement, CNS pathology, and toxicological events.

**Clinical significance:**
- ICU admission rate in patients with altered mental status: ~20%
- In-hospital mortality in AMS: ~10%
- GCS Eye component < 4 found in 22% of ICU-admitted patients in one large AI triage study

---

## 6. Feature Importance for Triage Prediction Models

### 6.1 Ranked Feature Importance (synthesised from 60+ ML studies)

**Tier 1 — Most consistently predictive:**
1. **SpO2** — most important vital sign across all reviews; most strongly associated with mortality
2. **Chief complaint** — removing it dropped Level 3 AUC from 0.946 → 0.537 (43% loss) in the KUTS study; NLP-enhanced models gain ~3 AUC points over structured-only models
3. **Age** — critical; elderly have atypical presentations, paediatrics have different physiology
4. **Mode of arrival** — ambulance/EMS arrival independently predicts high acuity and ICU admission
5. **GCS / consciousness level** — strong L1–2 discriminator

**Tier 2 — Important, consistently included:**
6. Systolic blood pressure
7. Heart rate
8. Respiratory rate
9. Diastolic blood pressure
10. Pain score (with caveats — see Section 4)
11. Temperature

**Tier 3 — Contextually valuable:**
12. Prior ED visits / prior admissions (adding history raised AUC from 0.87 → 0.92)
13. Sex / gender
14. Medication count / polypharmacy (proxy for medical complexity)
15. Race / ethnicity (predicts mistriage risk, not acuity directly)
16. Arrival time of day / shift

**Tier 4 — High value if available:**
17. Lab values — lactate, troponin, CRP, NLR — improve models significantly if available at triage
18. Specific comorbidities (immunocompromised, malignancy, CKD)
19. Mechanism of injury (for trauma)

### 6.2 Engineered Features to Create

| Feature | Formula / Definition | Why |
|---------|---------------------|-----|
| NEWS2 total | Sum of 6 parameter scores (see Section 2.3) | Single composite that captures vital sign interactions |
| Shock index | HR ÷ SBP | > 0.9 suggests haemodynamic compromise |
| qSOFA score | 1pt each: SBP ≤ 100, RR ≥ 22, GCS < 15 | ≥ 2 = sepsis mortality risk (use alongside NEWS2) |
| `hypoxia_flag` | SpO2 < 90% → 1 | Critical binary threshold |
| `shock_flag` | SBP < 90 mmHg → 1 | Critical binary threshold |
| `tachycardia_extreme` | HR > 130 bpm → 1 | Critical binary threshold |
| `any_danger_zone_vital` | Any ESI danger zone threshold breached → 1 | Composite safety net |
| `elderly_flag` | Age ≥ 65 → 1 | Apply elevated suspicion; undertriage risk marker |
| Pain × location | NRS_pain × (central=1 / peripheral=0) | Contextualises pain severity |

### 6.3 Model Architecture Findings (from systematic review)

- XGBoost: best in 52.6% of comparisons
- Gradient boosting overall: best in 82.7% of comparisons
- Deep neural networks: best in 66.6% when NLP is included
- Average AUC without NLP: 0.88; with NLP: 0.91
- Historical data + triage data: AUC 0.92 (vs. 0.87 triage data alone)
- Best published result: KUTS model — AUROC 0.958 overall, 0.941 for Level 3

### 6.4 Class Distribution (KTAS, 138,022-patient study)

| Level | Share |
|-------|-------|
| L1 | 1.4% |
| L2 | 11.7% |
| L3 | 56.3% |
| L4 | 26.1% |
| L5 | 4.5% |

Severe class imbalance — use weighted loss functions or focal loss. Consider binary targets first (L1–3 vs. L4–5, or ICU admission, 28-day mortality).

---

## 7. Known Causes of Mistriage

### 7.1 Undertriage (the dangerous error — prioritise eliminating this)

Overall undertriage rate: ~14–40% of visits; ~70% of all triage errors in KTAS studies.

**Patient factors:**
- **Age ≥ 65** (OR 1.22–3.05): atypical presentation, blunted physiological responses (e.g. no tachycardia in haemorrhagic shock due to beta-blockers), communication difficulty
- **Non-white race/ethnicity**: Black patients 2.35× more likely to be undertriaged than White patients in paediatric studies
- **Vague/nonspecific complaints** in frail elderly ("weakness", "not feeling well") — no complaint category captures severity

**Presentation / condition factors:**
- **Sepsis**: qSOFA misses > 53% of septic patients with organ dysfunction at triage
- **Aortic dissection**: undertriage delays CT by 8.9 minutes on average
- **Subarachnoid haemorrhage**: undertriage delays CT by 2.4 minutes, medications by 33.3 minutes
- **ACS in atypical presentation**: nausea + diaphoresis + chest discomfort assigned L3 instead of L2
- **Pain misjudgement**: failure to connect symptom constellation to underlying serious diagnosis
- **Extreme vital signs not acted on**: SpO2 ≤ 89 (OR 2.19), bradycardia ≤ 49 bpm (OR 2.54), tachycardia ≥ 130 bpm (OR 2.17) — all associated with undertriage despite being flagged

**System factors:**
- Not measuring SpO2 at triage — absence of measurement itself predicts undertriage
- Night shift / off-hours staffing
- Level 3 ambiguity — 88.4% of Level 3 misclassifications are downgraded to L4 (undertriage)

### 7.2 Overtriage (acceptable, but worth understanding)

Overall overtriage rate in adults: ~26%; in paediatrics: ~59%.

**Patient factors:**
- **Young adults (18–30)**: adjusted OR 1.73 for overtriage — youth is misjudged as susceptibility
- **Female patients**: anxiety amplifies self-reported pain; some evidence of overtriage in pain-driven scenarios
- **Trauma presentations**: OR 1.80 for overtriage — dramatic external appearance vs. physiological stability
- **Children 1–4 years**: higher baseline HR and RR misinterpreted as distress

**System factors:**
- Evening shift arrivals (OR 1.42 for overtriage)
- Self-referral with no pre-screening
- High raw pain score without clinical context

### 7.3 The Level 3 Problem

Level 3 is the most common (~50–60% of visits) and the most frequently misclassified category:
- 60.3% of all mistriage cases occur at Level 3 (large Chinese study)
- 88.4% of Level 3 misclassifications are down-triaged to Level 4 (undertriage direction)
- Standard algorithms achieve AUC ~0.60–0.82 for Level 3
- KUTS model achieved 0.941 for Level 3 — by far the hardest sub-problem
- Chief complaint text is the most critical feature for L3 vs. L4 discrimination

---

## 8. Special Populations

| Population | Key Consideration | Action |
|------------|------------------|--------|
| Age ≥ 65 | Atypical presentation, blunted vitals, polypharmacy — systemically undertriaged | Apply age-adjusted vital thresholds; flag as elevated risk |
| Immunocompromised | Any fever regardless of vitals → high-acuity concern | Hard-code fever + immunocompromised → L2 minimum |
| Infants < 90 days | Any fever → L2 in ESI/CTAS regardless of other vitals | |
| Paediatric (< 18) | Age-adjusted HR and RR thresholds differ substantially from adult | Use age-stratified vital sign reference ranges |
| Pregnancy > 20 weeks | Clinical thresholds change; separate triage pathway | Flag and escalate |

---

## 9. qSOFA Reference

| Criterion | Threshold | Points |
|-----------|-----------|--------|
| SBP | ≤ 100 mmHg | 1 |
| Respiratory rate | ≥ 22 bpm | 1 |
| Altered mentation | GCS < 15 | 1 |

Score ≥ 2 → 3–14× increase in in-hospital mortality in suspected infection.
**Limitation:** > 53% of sepsis patients with organ dysfunction score < 2 at triage — use NEWS2 in parallel.

---

## Sources

1. EMSC Improvement Center — *Emergency Severity Index (ESI) Handbook, 5th Edition*
2. StatPearls / NCBI Bookshelf — *Emergency Department Triage* (NBK557583)
3. PMC6859273 — Machine Learning-Based Prediction of KTAS Level
4. PMC6730846 — Triage Accuracy and Causes of Mistriage Using KTAS (Moon et al., 2019) — the source paper for the Korean dataset
5. PMC6508716 — Over-triage with Pain in KTAS
6. PMC11575054 — Improving Triage Performance Using ML and NLP: Systematic Review (60 studies)
7. PMC10475743 — Associated Factors of Under and Over-Triage Using ESI
8. PMC8730791 — Accuracy of ESI: Independent Predictors of Under/Over Triage
9. PMC12314101 — KUTS: A Foundational Triage System for Moderate Acuity Classification (AUROC 0.958)
10. PMC8760028 — Abnormal Vital Signs and Mortality in the ED
11. PMC9309291 — Revising Vital Sign Criteria for Older Adults in Triage
12. PMC12378333 — AI-Based Emergency Triage Model (ICU Prediction)
13. PMC6054406 — Predicting Hospital Admission at ED Triage Using ML
14. PMC7531169 — Using ML Risk Prediction Models to Triage Acuity: Systematic Review
15. iatrox.com — NEWS2 Scoring and Escalation Guide
16. PMC7602891 — NEWS2 as Prognostic Tool in the ED
17. Nature Scientific Reports — qSOFA Sensitivity at Triage for Sepsis (s41598-020-77438-8)
18. Australian Commission on Safety and Quality — ATS Descriptors for Categories
19. Cambridge Core — CTAS Revisions 2016 (Canadian Journal of Emergency Medicine)
20. TriageIQ Blog — Triage Systems Compared: MTS, ESI, CTAS, ATS, SATS
21. PMC5016055 — Manchester Triage System: Flowcharts, Discriminators and Outcomes
22. PMC4143318 — Undertriage in Older ED Patients
23. PMC11320334 — Paediatric Triage Accuracy Using ESI
