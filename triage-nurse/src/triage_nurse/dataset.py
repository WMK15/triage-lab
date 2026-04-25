"""KTAS dataset loader for triage-batch v2.

Reads dataset/emergency-triage.csv (semicolon-separated, n=1267) on first
access, decodes the categorical encodings documented in dataset/README.md,
and exposes helpers consumed by the env:

  - load_row(row_index) -> Patient
  - split_row_indices(split) -> list[int]
  - select_diverse_batch(seed, n=5, split=...) -> list[int] of valid row indices
  - list_task_specs(split) -> deterministic batch tasks for OpenReward

The train/test split is deterministic and stratified by KTAS level. Rows with
corrupt encodings are skipped and excluded from both splits.
"""

from __future__ import annotations

import csv
import hashlib
from pathlib import Path
from typing import Any

from .world_state import KtasLevel, MentalState, Patient, TrajectoryStep, Vitals

# dataset CSVs live at the repo root, two levels up from this file's parent
# (triage-nurse/src/triage_nurse/dataset.py).
DATASET_DIR = Path(__file__).parent.parent.parent.parent / "dataset"
COMBINED_DATASET_PATH = DATASET_DIR / "combined-triage-reference.csv"
LEGACY_DATASET_PATH = DATASET_DIR / "emergency-triage.csv"

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


def _legacy_row_to_patient(row: dict[str, str], row_index: int) -> Patient | None:
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


def _normalise_combined_sex(row: dict[str, str], source: str) -> str:
    sex = (row.get("sex") or "").strip()
    if sex in {"F", "M"}:
        return sex
    decoded = _decode_sex(sex)
    if decoded:
        return decoded
    return str(_SOURCE_DEFAULTS.get(source, {}).get("sex", "F"))


def _normalise_combined_mental(row: dict[str, str], source: str) -> MentalState:
    mental = (row.get("mental_state") or "").strip().lower()
    if mental in {"alert", "verbal", "pain", "unresponsive"}:
        return mental  # type: ignore[return-value]
    if mental in {"1", "2", "3", "4"}:
        return _decode_mental(mental)
    return str(_SOURCE_DEFAULTS.get(source, {}).get("mental_state", "alert"))  # type: ignore[return-value]


def _normalise_combined_temp(value: str | None) -> float | None:
    temp = _safe_float(value)
    if temp is None:
        return None
    if temp > 70:
        return round((temp - 32) * 5 / 9, 1)
    return temp


def _combined_row_to_patient(row: dict[str, str], row_index: int) -> Patient | None:
    source = (row.get("source") or "ktas").strip() or "ktas"
    chief = (row.get("chief_complaint") or row.get("diagnosis") or "").strip()
    if not chief:
        return None

    ktas = _parse_ktas(row.get("reference_level"))
    if ktas is None:
        return None

    age = _safe_int(row.get("age"))
    if age is None:
        age = int(_SOURCE_DEFAULTS.get(source, {}).get("age", 50))
    sex = _normalise_combined_sex(row, source)
    mental = _normalise_combined_mental(row, source)

    sbp = _safe_int(row.get("sbp"))
    dbp = _safe_int(row.get("dbp"))
    hr = _safe_int(row.get("hr"))
    rr = _safe_int(row.get("rr"))
    bt = _normalise_combined_temp(row.get("temp_c"))
    sat = _safe_int(row.get("spo2"))

    defaults = _SOURCE_DEFAULTS.get(source, _SOURCE_DEFAULTS["symptom_reference"])
    if sbp is None:
        sbp = int(defaults["sbp"])
    if dbp is None:
        dbp = int(defaults["dbp"])
    if hr is None:
        hr = int(defaults["hr"])
    if rr is None:
        rr = int(defaults["rr"])
    if bt is None:
        bt = float(defaults["temp_c"])
    if sat is None or sat < 50 or sat > 100:
        sat = int(defaults["spo2"])

    pain_raw = (row.get("pain_score") or "").strip()
    nrs_pain = _safe_int(pain_raw)
    if nrs_pain is not None and (nrs_pain < 0 or nrs_pain > 10):
        nrs_pain = None

    pid = str((row.get("source_id") or f"row-{row_index}").strip() or f"row-{row_index}")
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
            hr=hr,
            sbp=sbp,
            dbp=dbp,
            rr=rr,
            spo2=sat,
            temp_c=bt,
        ),
        trajectory=_synthesize_trajectory(pid, ktas, chief),
        ground_truth_ktas=ktas,
    )


def _row_to_patient(row: dict[str, str], row_index: int) -> Patient | None:
    if "reference_level" in row or "source" in row:
        return _combined_row_to_patient(row, row_index)
    return _legacy_row_to_patient(row, row_index)


_rows_cache: list[dict[str, str]] | None = None
_valid_indices_cache: dict[KtasLevel, list[int]] | None = None
_split_indices_cache: dict[str, list[int]] | None = None

_TRAIN_ROW_TARGET = 1000
_TASK_COUNTS: dict[str, int] = {"train": 256, "test": 64}
_TASK_SEED_OFFSETS: dict[str, int] = {"train": 0, "test": 10_000}

_SOURCE_DEFAULTS: dict[str, dict[str, int | float | str]] = {
    "symptom_reference": {
        "age": 52,
        "sex": "F",
        "mental_state": "alert",
        "sbp": 128,
        "dbp": 78,
        "hr": 86,
        "rr": 18,
        "temp_c": 36.8,
        "spo2": 97,
    },
    "ed_triage": {
        "age": 58,
        "sex": "F",
        "mental_state": "alert",
        "sbp": 132,
        "dbp": 78,
        "hr": 90,
        "rr": 19,
        "temp_c": 37.0,
        "spo2": 97,
    },
}


def _load_rows() -> list[dict[str, str]]:
    """Read and cache all CSV rows. Called lazily on first access."""
    global _rows_cache
    if _rows_cache is None:
        if COMBINED_DATASET_PATH.exists():
            with COMBINED_DATASET_PATH.open(encoding="utf-8", errors="replace") as f:
                reader = csv.DictReader(f)
                _rows_cache = list(reader)
        else:
            with LEGACY_DATASET_PATH.open(encoding="utf-8", errors="replace") as f:
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


def _stable_sort(indices: list[int], salt: str) -> list[int]:
    return sorted(
        indices,
        key=lambda idx: hashlib.sha256(f"{salt}|{idx}".encode()).hexdigest(),
    )


def _build_split_indices() -> dict[str, list[int]]:
    global _split_indices_cache
    if _split_indices_cache is not None:
        return _split_indices_cache

    valid = _build_valid_indices()
    total = sum(len(indices) for indices in valid.values())
    if total == 0:
        _split_indices_cache = {"train": [], "test": []}
        return _split_indices_cache

    train_target = min(_TRAIN_ROW_TARGET, total)
    allocated: dict[KtasLevel, int] = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    remainders: list[tuple[float, KtasLevel]] = []
    assigned = 0

    for level in (1, 2, 3, 4, 5):
        level_total = len(valid[level])
        if level_total == 0:
            continue
        exact = (level_total * train_target) / total
        base = min(level_total, int(exact))
        allocated[level] = base
        assigned += base
        remainders.append((exact - base, level))

    remaining = train_target - assigned
    for _, level in sorted(remainders, reverse=True):
        if remaining <= 0:
            break
        if allocated[level] < len(valid[level]):
            allocated[level] += 1
            remaining -= 1

    if remaining > 0:
        for level in (1, 2, 3, 4, 5):
            while remaining > 0 and allocated[level] < len(valid[level]):
                allocated[level] += 1
                remaining -= 1

    train_indices: list[int] = []
    test_indices: list[int] = []
    for level in (1, 2, 3, 4, 5):
        ordered = _stable_sort(valid[level], f"split|{level}")
        cutoff = allocated[level]
        train_indices.extend(ordered[:cutoff])
        test_indices.extend(ordered[cutoff:])

    _split_indices_cache = {
        "train": sorted(train_indices),
        "test": sorted(test_indices),
    }
    return _split_indices_cache


def split_row_indices(split: str) -> list[int]:
    if split not in ("train", "test"):
        raise ValueError(f"unknown split {split!r}; expected 'train' or 'test'")
    return list(_build_split_indices()[split])


def load_row(row_index: int) -> Patient:
    """Load one CSV row as a Patient. Raises if the row is unusable."""
    rows = _load_rows()
    if row_index < 0 or row_index >= len(rows):
        raise IndexError(f"row_index {row_index} out of range [0, {len(rows)})")
    patient = _row_to_patient(rows[row_index], row_index)
    if patient is None:
        raise ValueError(f"row {row_index} is unusable (missing fields or corrupt encoding)")
    return patient


def select_diverse_batch(seed: int, n: int = 5, split: str | None = None) -> list[int]:
    """Return n CSV row indices with at least one KTAS 1-2 and at least one
    KTAS 4-5. Deterministic given seed.

    For n=5: guaranteed to include one row from each KTAS level (1..5) when
    possible. Smaller n: prioritises severity diversity.
    """
    valid = _build_valid_indices()
    allowed = set(split_row_indices(split)) if split is not None else None
    rng_state = int(
        hashlib.sha256(f"diverse|{split or 'all'}|{seed}|{n}".encode()).hexdigest()[:16], 16
    )

    def _pick(level: KtasLevel, taken: set[int]) -> int | None:
        pool = [i for i in valid[level] if i not in taken and (allowed is None or i in allowed)]
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


def list_task_specs(split: str, n: int = 5) -> list[dict[str, Any]]:
    if split not in ("train", "test"):
        raise ValueError(f"unknown split {split!r}; expected 'train' or 'test'")

    task_count = _TASK_COUNTS[split]
    seed_offset = _TASK_SEED_OFFSETS[split]
    tasks: list[dict[str, Any]] = []

    for task_index in range(task_count):
        seed = seed_offset + task_index
        row_indices = select_diverse_batch(seed=seed, n=n, split=split)
        ground_truth = [load_row(i).ground_truth_ktas for i in row_indices]
        tasks.append(
            {
                "id": f"{split}-batch-{task_index:04d}",
                "name": f"{split.title()} Batch {task_index:04d}",
                "row_indices": row_indices,
                "ground_truth_ktas": ground_truth,
                "max_turns": 50,
                "shift_length_min": 60,
                "seed": seed,
                "n": n,
                "split": split,
            }
        )

    return tasks
