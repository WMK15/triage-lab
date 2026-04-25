# Cases

Patient case templates for the triage-nurse env. The format is anchored by
`example_acute_mi.json` — the worked NSTEMI reference.

## Source dataset

Real patient substrate lives at the repo root: `dataset/emergency-triage.csv`
(KTAS, n=1267, expert-graded ground truth). See `dataset/README.md` for the
column schema and encodings.

Sub-agent E should select rows that exercise the three pressure points:
1. **Silent deterioration** — patient who looks stable on arrival but
   progresses if not reassessed (e.g., low NRS pain + abnormal vitals).
2. **Multi-consultant / finite cooperation** — patient where the right
   answer needs both medicine and surgery, and reflexive early calls burn
   that capital.
3. **Deferred-info recall** — case whose nursing observation early in the
   shift is dispositive only if recalled hours later.

Plus at least one **routine** case so the agent has a chance to feel
competent before things get hard.

## Mapping CSV → case template

| CSV column           | Template field                |
|----------------------|-------------------------------|
| `Sex` (1=F, 2=M)     | `sex`                         |
| `Age`                | `age`                         |
| `Chief_complain`     | `presenting_complaint`        |
| `SBP/DBP/HR/RR/BT`   | `vitals_initial.*`            |
| `Saturation`         | `vitals_initial.spo2`         |
| `Mental` / `Pain` / `NRS_pain` | derived narrative   |
| `KTAS_expert`        | grounds the `severity` truth  |
| `Diagnosis in ED`    | seed for `true_diagnosis`     |
| `Disposition`        | grounds the correct disposition |

The `trajectory`, `persona`, `red_herrings`, and `narrative_role` are
authored — the dataset gives the substrate, not the story.
