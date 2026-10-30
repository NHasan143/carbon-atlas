"""Tests for validate_dataset.py, plus the check of the bundled dataset itself.

Run from the project root:
    python -m pytest tests
"""

import copy
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import validate_dataset as vd  # noqa: E402

SHA = "a" * 64


def valid_payload():
    return {
        "years": [2000, 2001, 2002],
        "countries": [
            {"iso3": "AAA", "name": "Aland", "continent": "Europe"},
            {"iso3": "BBB", "name": "Bland", "continent": "Asia"},
        ],
        "metrics": {
            "population": {"AAA": [10, 11, 12], "BBB": [5, None, 7]},
            "share_global_co2": {"AAA": [0.5, 0.6, 100]},
        },
        "metricMeta": {
            "population": {"label": "Population", "unit": "people", "vmax": 12},
            "share_global_co2": {"label": "Share of global CO2", "unit": "%", "vmax": 0.6},
        },
        "estimated": {"population": {"AAA": [1]}},
        "meta": {
            "generatedAt": "2026-10-30T20:00:00Z",
            "sources": [{"id": "co2", "url": "https://example.org/co2.csv", "version": None,
                         "sha256": SHA, "retrievedAt": "2026-09-19T19:50:01Z"}],
        },
    }


def lock_for(payload):
    return {"sources": {s["id"]: {k: v for k, v in s.items() if k != "id"}
                        for s in payload["meta"]["sources"]}}


def checks(errors):
    return {e.split("]")[0].lstrip("[") for e in errors}


def test_a_valid_payload_passes():
    payload = valid_payload()
    assert vd.validate(payload, lock_for(payload)) == []


@pytest.mark.parametrize("mutate, check", [
    # Duplicate country records.
    (lambda p: p["countries"].append({"iso3": "AAA", "name": "Again"}), "duplicates"),
    # Series alignment.
    (lambda p: p["metrics"]["population"]["AAA"].pop(), "alignment"),
    (lambda p: p["metrics"]["population"].update(ZZZ=[1, 2, 3]), "alignment"),
    (lambda p: p.update(years=[2000, 2002, 2003]), "years"),
    (lambda p: p.update(years=[2000, 2000, 2001]), "years"),
    (lambda p: p["estimated"]["population"].update(AAA=[3]), "alignment"),
    # Finite values.
    (lambda p: p["metrics"]["population"]["AAA"].__setitem__(0, float("nan")), "finite"),
    (lambda p: p["metrics"]["population"]["AAA"].__setitem__(0, float("inf")), "finite"),
    (lambda p: p["metrics"]["population"]["AAA"].__setitem__(0, "12"), "finite"),
    (lambda p: p["metricMeta"]["population"].update(vmax=float("nan")), "finite"),
    # Valid ranges.
    (lambda p: p["metrics"]["share_global_co2"]["AAA"].__setitem__(1, 100.01), "range"),
    (lambda p: p["metrics"]["population"]["BBB"].__setitem__(0, -1), "range"),
    # Interpolation flags pointing at nothing.
    (lambda p: p["estimated"]["population"].update(BBB=[1]), "estimated"),
    # Provenance.
    (lambda p: p["meta"].pop("generatedAt"), "provenance"),
    (lambda p: p["meta"]["sources"][0].update(sha256="nope"), "provenance"),
    (lambda p: p["meta"]["sources"][0].update(retrievedAt="yesterday"), "provenance"),
    (lambda p: p["meta"].update(sources=[]), "provenance"),
])
def test_each_check_catches_its_failure(mutate, check):
    payload = valid_payload()
    lock = lock_for(payload)
    mutate(payload)
    errors = vd.validate(payload, lock)
    assert check in checks(errors), errors


def test_dataset_must_match_the_source_lock():
    payload = valid_payload()
    lock = copy.deepcopy(lock_for(payload))
    lock["sources"]["co2"]["sha256"] = "b" * 64
    errors = vd.validate(payload, lock)
    assert any("sha256 differs from sources.lock.json" in e for e in errors)


def test_loader_rejects_duplicate_keys_and_non_finite_numbers(tmp_path):
    dupe = tmp_path / "dupe.json"
    # The same country twice under one metric is a duplicate country-year record.
    dupe.write_text('{"metrics": {"population": {"AAA": [1], "AAA": [2]}}}')
    with pytest.raises(vd.DatasetFormatError, match="duplicate key 'AAA'"):
        vd.load_dataset(dupe)

    nan = tmp_path / "nan.json"
    nan.write_text('{"metrics": {"population": {"AAA": [NaN]}}}')
    with pytest.raises(vd.DatasetFormatError, match="non-finite"):
        vd.load_dataset(nan)


def test_cli_reports_failures_with_exit_status(tmp_path, capsys):
    payload = valid_payload()
    payload["metrics"]["share_global_co2"]["AAA"][0] = 140
    path = tmp_path / "dataset.json"
    path.write_text(json.dumps(payload))
    lock = tmp_path / "lock.json"
    lock.write_text(json.dumps(lock_for(payload)))
    assert vd.main([str(path), "--lock", str(lock)]) == 1
    assert "140% is above 100%" in capsys.readouterr().err


def test_bundled_dataset_is_valid_and_matches_the_lock():
    payload = vd.load_dataset(vd.DEFAULT_DATASET)
    lock = json.loads(vd.DEFAULT_LOCK.read_text())
    assert vd.validate(payload, lock) == []
