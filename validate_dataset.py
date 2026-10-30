"""Check public/dataset.json before it ships.

Standard library only, so CI can run it without the pipeline's dependencies:

    python validate_dataset.py                      # public/dataset.json vs sources.lock.json
    python validate_dataset.py path/to/dataset.json --lock sources.lock.json

build_dataset.py runs the same checks on every build and refuses to write a
dataset that fails them. Exit status is 1 when any check fails.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
DEFAULT_DATASET = HERE / "public" / "dataset.json"
DEFAULT_LOCK = HERE / "sources.lock.json"

ISO3 = re.compile(r"^[A-Z]{3}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
MAX_ERRORS_PER_CHECK = 5


class DatasetFormatError(ValueError):
    """The file is not strict JSON, or repeats a key within one object."""


def _no_duplicate_keys(pairs):
    seen = {}
    for key, value in pairs:
        if key in seen:
            # In this format a repeated key is a repeated record: a second
            # country under one metric, or a second definition of a metric.
            raise DatasetFormatError(f"duplicate key {key!r}")
        seen[key] = value
    return seen


def _reject_constant(name):
    raise DatasetFormatError(f"non-finite number {name} is not valid JSON")


def load_dataset(path: Path) -> dict:
    return json.loads(path.read_text(), object_pairs_hook=_no_duplicate_keys,
                      parse_constant=_reject_constant)


def _is_iso_datetime(value) -> bool:
    if not isinstance(value, str):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


class _Errors(list):
    """Collects messages, keeping each check's output short."""

    def __init__(self):
        super().__init__()
        self._counts: dict[str, int] = {}

    def add(self, check: str, message: str) -> None:
        n = self._counts.get(check, 0) + 1
        self._counts[check] = n
        if n <= MAX_ERRORS_PER_CHECK:
            self.append(f"[{check}] {message}")
        elif n == MAX_ERRORS_PER_CHECK + 1:
            self.append(f"[{check}] … further failures of this check omitted")


def validate(payload: dict, lock: dict | None = None) -> list[str]:
    """Return a list of problems with `payload`; empty means it is valid."""
    errors = _Errors()

    for key in ("years", "countries", "metrics", "metricMeta", "estimated", "meta"):
        if key not in payload:
            errors.add("structure", f"missing top-level key {key!r}")
    if errors:
        return list(errors)

    # Years: one shared, gap-free axis that every series is aligned to.
    years = payload["years"]
    if not years or not all(isinstance(y, int) and not isinstance(y, bool) for y in years):
        errors.add("years", "years must be a non-empty list of integers")
        return list(errors)
    if any(b - a != 1 for a, b in zip(years, years[1:])):
        errors.add("years", "years must be consecutive and ascending, with no repeats")
    n_years = len(years)

    # Countries: one record per ISO-3 code.
    country_isos: set[str] = set()
    for record in payload["countries"]:
        iso = record.get("iso3")
        if not isinstance(iso, str) or not ISO3.match(iso):
            errors.add("countries", f"invalid iso3 {iso!r}")
            continue
        if iso in country_isos:
            errors.add("duplicates", f"country {iso} is listed more than once")
        country_isos.add(iso)
        if not record.get("name"):
            errors.add("countries", f"{iso} has no name")

    metrics, meta_by_metric = payload["metrics"], payload["metricMeta"]
    if set(metrics) != set(meta_by_metric):
        errors.add("structure", "metrics and metricMeta must define the same metric keys")

    for metric, by_iso in metrics.items():
        meta = meta_by_metric.get(metric, {})
        is_percent = meta.get("unit") == "%"
        vmax = meta.get("vmax")
        if not _is_number(vmax) or not math.isfinite(vmax) or vmax <= 0:
            errors.add("finite", f"{metric}: vmax {vmax!r} must be a finite positive number")
        for iso, series in by_iso.items():
            where = f"{metric}/{iso}"
            if iso not in country_isos:
                errors.add("alignment", f"{where}: not in the countries list")
            if not isinstance(series, list) or len(series) != n_years:
                got = len(series) if isinstance(series, list) else type(series).__name__
                errors.add("alignment", f"{where}: series has {got} entries, expected {n_years} (one per year)")
                continue
            if all(v is None for v in series):
                errors.add("alignment", f"{where}: all-null series should be omitted")
            for i, value in enumerate(series):
                if value is None:
                    continue
                year = years[i]
                if not _is_number(value) or not math.isfinite(value):
                    errors.add("finite", f"{where} {year}: {value!r} is not a finite number")
                    continue
                if value < 0:
                    errors.add("range", f"{where} {year}: {value} is negative")
                if is_percent and value > 100:
                    errors.add("range", f"{where} {year}: {value}% is above 100%")

    # Interpolation flags must point at values that exist.
    for metric, by_iso in payload["estimated"].items():
        if metric not in metrics:
            errors.add("estimated", f"flags for unknown metric {metric!r}")
            continue
        for iso, indexes in by_iso.items():
            series = metrics[metric].get(iso)
            if series is None:
                errors.add("estimated", f"{metric}/{iso}: flagged but has no series")
                continue
            if indexes != sorted(set(indexes)):
                errors.add("estimated", f"{metric}/{iso}: indexes must be unique and ascending")
            for i in indexes:
                if not isinstance(i, int) or not 0 <= i < n_years:
                    errors.add("alignment", f"{metric}/{iso}: estimated index {i!r} is outside the years")
                elif series[i] is None:
                    errors.add("estimated", f"{metric}/{iso} {years[i]}: flagged as estimated but has no value")

    _validate_meta(payload["meta"], errors, lock)
    return list(errors)


def _validate_meta(meta: dict, errors: _Errors, lock: dict | None) -> None:
    if not _is_iso_datetime(meta.get("generatedAt")):
        errors.add("provenance", "meta.generatedAt must be an ISO 8601 timestamp")
    sources = meta.get("sources")
    if not isinstance(sources, list) or not sources:
        errors.add("provenance", "meta.sources must list every upstream source")
        return
    for source in sources:
        sid = source.get("id", "?")
        if not str(source.get("url", "")).startswith("https://"):
            errors.add("provenance", f"source {sid}: url must be an https URL")
        if not SHA256.match(str(source.get("sha256", ""))):
            errors.add("provenance", f"source {sid}: sha256 must be 64 hex characters")
        if not _is_iso_datetime(source.get("retrievedAt")):
            errors.add("provenance", f"source {sid}: retrievedAt must be an ISO 8601 timestamp")

    if lock is None:
        return
    # The dataset must have been built from exactly the locked sources.
    locked = lock.get("sources", {})
    exported = {s.get("id"): s for s in sources}
    if set(locked) != set(exported):
        errors.add("provenance", f"dataset sources {sorted(exported)} differ from sources.lock.json {sorted(locked)}")
    for sid in set(locked) & set(exported):
        for field in ("sha256", "version", "url", "retrievedAt"):
            if locked[sid].get(field) != exported[sid].get(field):
                errors.add("provenance", f"source {sid}: {field} differs from sources.lock.json; rebuild the dataset")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("dataset", nargs="?", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK,
                        help="sources.lock.json the dataset must match (default: %(default)s)")
    args = parser.parse_args(argv)

    try:
        payload = load_dataset(args.dataset)
    except (DatasetFormatError, json.JSONDecodeError) as exc:
        print(f"{args.dataset}: {exc}", file=sys.stderr)
        return 1
    lock = json.loads(args.lock.read_text()) if args.lock.exists() else None
    if lock is None:
        print(f"{args.lock} not found: skipping the source lock comparison", file=sys.stderr)

    errors = validate(payload, lock)
    if errors:
        print(f"{args.dataset}: {len(errors)} problem(s)", file=sys.stderr)
        for line in errors:
            print(f"  {line}", file=sys.stderr)
        return 1
    n_series = sum(len(by_iso) for by_iso in payload["metrics"].values())
    print(f"{args.dataset}: OK ({len(payload['countries'])} countries, "
          f"{payload['years'][0]}-{payload['years'][-1]}, {n_series} series)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
