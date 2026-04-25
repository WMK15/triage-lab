"""KTAS dataset loader for triage-batch v2.

Reads dataset/emergency-triage.csv (semicolon-separated, n=1267) on first
access, decodes the categorical encodings documented in dataset/README.md,
and exposes two helpers consumed by the env:

  - load_row(row_index) -> Patient
  - select_diverse_batch(seed, n=5) -> list[int] of valid row indices

Rows with corrupt encodings (e.g. mojibake in NRS_pain) are skipped and the
indices excluded from the valid pool. The file is read once and cached.
"""
from __future__ import annotations

import csv
import hashlib
from pathlib import Path

from .world_state import KtasLevel, MentalState, Patient, TrajectoryStep, Vitals

# dataset/emergency-triage.csv lives at the repo root, two levels up from
# this file's parent (triage-nurse/src/triage_nurse/dataset.py).
DATASET_PATH = (
    Path(__file__).parent.parent.parent.parent / "dataset" / "emergency-triage.csv"
)

_MENTAL_DECODE: dict[str, MentalState] = {
    "1": "alert",
    "2": "verbal",
    "3": "pain",
    "4": "unresponsive",
}

# Per-KTAS narrative templates for the 30-min trajectory step. Picked
# deterministically by hashing patient.id so the same row always renders the
# same trajectory but rows differ from each other.
_KTAS_30MIN_TEMPLATES: dict[int, list[str]] = {
    1: [
        "Critical deterioration: vitals decompensating, immediate resuscitation required.",
        "Pulseless on monitor reassessment; full code in progress.",
        "GCS dropping fast; airway compromise imminent.",
    ],
    2: [
        "Worsening — vitals trending abnormal; high risk of rapid decline.",
        "ECG changes evolving; symptoms intensifying with diaphoresis.",
        "Mental status fluctuating; oxygen requirement rising.",
    ],
    3: [
        "Stable, persistent symptoms; pathology likely but not life-threatening.",
        "Vitals at the edge of normal; monitor and reassess in 30 min.",
        "Pain persists despite first-line analgesia; consider further workup.",
    ],
    4: [
        "Stable, comfortable; baseline mostly reassuring.",
        "Symptoms unchanged; no red flags emerging.",
        "Patient remains well-appearing on reassessment.",
    ],
    5: [
        "Improving on its own; no active intervention needed.",
        "Self-limiting presentation; vitals normal throughout.",
        "Patient asking when they can leave; nothing acute on reassessment.",
    ],
}

# 60-min step only present for KTAS 1-2 to make wait() informative on the
# severe end and quiet on the mild end.
_KTAS_60MIN_TEMPLATES: dict[int, list[str]] = {
    1: [
        "Severe: ROSC achieved transiently; ICU admission and intensive monitoring critical.",
        "Profound hypoperfusion; vasopressors started.",
    ],
    2: [
        "Severe: signs of end-organ stress; admission for higher-level monitoring needed.",
        "Symptoms now refractory to initial therapy; escalate care.",
    ],
}


def _safe_int(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _safe_float(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        # CSV uses both "." and "," as decimal separators in different fields.
        return float(value.replace(",", "."))
    except (TypeError, ValueError):
        return None


def _parse_ktas(value: str | None) -> KtasLevel | None:
    n = _safe_int(value)
    if n in (1, 2, 3, 4, 5):
        return n  # type: ignore[return-value]
    return None


def _decode_sex(value: str) -> str | None:
    if value == "1":
        return "F"
    if value == "2":
        return "M"
    return None


def _decode_mental(value: str) -> MentalState:
    return _MENTAL_DECODE.get(value.strip(), "alert")


def _pick_template(templates: list[str], salt: str) -> str:
    """Deterministically pick a template by hashing salt — same patient, same
    template every time, but different patients get different templates."""
    digest = hashlib.sha256(salt.encode()).digest()
    idx = int.from_bytes(digest[:4], "big") % len(templates)
    return templates[idx]


def _synthesize_trajectory(
    patient_id: str, ktas: int, chief_complaint: str
) -> list[TrajectoryStep]:
    steps = [
        TrajectoryStep(
            time_offset_min=0,
            state=f"On arrival: {chief_complaint}",
            requires_intervention=ktas <= 2,
        ),
        TrajectoryStep(
            time_offset_min=30,
            state=_pick_template(_KTAS_30MIN_TEMPLATES[ktas], f"{patient_id}|30"),
            requires_intervention=ktas <= 2,
        ),
    ]
    if ktas <= 2:
        steps.append(
            TrajectoryStep(
                time_offset_min=60,
                state=_pick_template(_KTAS_60MIN_TEMPLATES[ktas], f"{patient_id}|60"),
                requires_intervention=True,
            )
        )
    return steps


def _build_history(
    age: int,
    sex: str,
    mental: MentalState,
    nrs_pain: int | None,
    chief: str,
) -> str:
    parts: list[str] = [f"{age}{sex.lower()}"]
    parts.append(f"mental: {mental}")
    if nrs_pain is not None:
        parts.append(f"NRS pain {nrs_pain}/10")
    else:
        parts.append("pain not reported")
    parts.append(f"presents with: {chief}")
    return ", ".join(parts)


def _row_to_patient(row: dict[str, str], row_index: int) -> Patient | None:
    """Convert one CSV row dict to a Patient. Returns None if the row is
    unusable (missing required fields, corrupt encodings)."""
    sex = _decode_sex(row.get("Sex", "").strip())
    age = _safe_int(row.get("Age"))
    chief = (row.get("Chief_complain") or "").strip()
    if not (sex and age is not None and chief):
        return None

    ktas = _parse_ktas(row.get("KTAS_expert"))
    if ktas is None:
        return None

    sbp = _safe_int(row.get("SBP"))
    dbp = _safe_int(row.get("DBP"))
    hr = _safe_int(row.get("HR"))
    rr = _safe_int(row.get("RR"))
    bt = _safe_float(row.get("BT"))
    if None in (sbp, dbp, hr, rr) or bt is None:
        return None

    sat = _safe_int(row.get("Saturation"))
    if sat is None or sat < 50 or sat > 100:
        sat = 96  # default for missing / placeholder values

    mental = _decode_mental(row.get("Mental", "1"))
    nrs_raw = (row.get("NRS_pain") or "").strip()
    nrs_pain = _safe_int(nrs_raw) if nrs_raw and nrs_raw.isdigit() else None
    if nrs_pain is not None and (nrs_pain < 0 or nrs_pain > 10):
        nrs_pain = None

    pid = f"row-{row_index}"
    history = _build_history(age, sex, mental, nrs_pain, chief)

    return Patient(
        id=pid,
        age=age,
        sex=sex,  # type: ignore[arg-type]
        chief_complaint=chief,
        history=history,
        mental_state=mental,
        nrs_pain=nrs_pain,
        vitals=Vitals(
            hr=hr,  # type: ignore[arg-type]
            sbp=sbp,  # type: ignore[arg-type]
            dbp=dbp,  # type: ignore[arg-type]
            rr=rr,  # type: ignore[arg-type]
            spo2=sat,
            temp_c=bt,
        ),
        trajectory=_synthesize_trajectory(pid, ktas, chief),
        ground_truth_ktas=ktas,
    )


_rows_cache: list[dict[str, str]] | None = None
_valid_indices_cache: dict[KtasLevel, list[int]] | None = None


def _load_rows() -> list[dict[str, str]]:
    """Read and cache all CSV rows. Called lazily on first access."""
    global _rows_cache
    if _rows_cache is None:
        with DATASET_PATH.open(encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f, delimiter=";")
            _rows_cache = list(reader)
    return _rows_cache


def _build_valid_indices() -> dict[KtasLevel, list[int]]:
    """Group all CSV row indices by KTAS_expert level, dropping unparseable rows."""
    global _valid_indices_cache
    if _valid_indices_cache is None:
        rows = _load_rows()
        out: dict[int, list[int]] = {1: [], 2: [], 3: [], 4: [], 5: []}
        for i, row in enumerate(rows):
            patient = _row_to_patient(row, i)
            if patient is not None:
                out[patient.ground_truth_ktas].append(i)
        _valid_indices_cache = out  # type: ignore[assignment]
    return _valid_indices_cache  # type: ignore[return-value]


def load_row(row_index: int) -> Patient:
    """Load one CSV row as a Patient. Raises if the row is unusable."""
    rows = _load_rows()
    if row_index < 0 or row_index >= len(rows):
        raise IndexError(f"row_index {row_index} out of range [0, {len(rows)})")
    patient = _row_to_patient(rows[row_index], row_index)
    if patient is None:
        raise ValueError(f"row {row_index} is unusable (missing fields or corrupt encoding)")
    return patient


def select_diverse_batch(seed: int, n: int = 5) -> list[int]:
    """Return n CSV row indices with at least one KTAS 1-2 and at least one
    KTAS 4-5. Deterministic given seed.

    For n=5: guaranteed to include one row from each KTAS level (1..5) when
    possible. Smaller n: prioritises severity diversity.
    """
    valid = _build_valid_indices()
    rng_state = int(hashlib.sha256(f"diverse|{seed}|{n}".encode()).hexdigest()[:16], 16)

    def _pick(level: KtasLevel, taken: set[int]) -> int | None:
        pool = [i for i in valid[level] if i not in taken]
        if not pool:
            return None
        nonlocal rng_state
        rng_state = (rng_state * 1103515245 + 12345) & 0x7FFFFFFF
        return pool[rng_state % len(pool)]

    chosen: list[int] = []
    taken: set[int] = set()
    # First pass: one per level for diversity.
    for level in (1, 2, 3, 4, 5):
        if len(chosen) >= n:
            break
        idx = _pick(level, taken)  # type: ignore[arg-type]
        if idx is not None:
            chosen.append(idx)
            taken.add(idx)
    # Second pass: fill any remaining slots from the larger pools.
    while len(chosen) < n:
        for level in (3, 2, 4, 1, 5):
            if len(chosen) >= n:
                break
            idx = _pick(level, taken)  # type: ignore[arg-type]
            if idx is not None:
                chosen.append(idx)
                taken.add(idx)
        else:
            continue
        break
    return chosen
