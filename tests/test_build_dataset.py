"""Tests for the gap filling in build_dataset.py.

Run from the project root:
    python -m pytest tests/test_build_dataset.py
"""

import math
import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_dataset as bd  # noqa: E402

NAN = float("nan")


def series(values, start=2000):
    return pd.Series(values, index=range(start, start + len(values)), dtype="float64")


def as_list(s):
    return [None if math.isnan(v) else v for v in s.tolist()]


def test_fills_a_one_year_gap():
    filled, estimated = bd.fill_short_gaps(series([10, NAN, 30]))
    assert as_list(filled) == [10, 20, 30]
    assert estimated.tolist() == [False, True, False]


def test_fills_a_three_year_gap_completely():
    filled, estimated = bd.fill_short_gaps(series([0, NAN, NAN, NAN, 40]))
    assert as_list(filled) == [0, 10, 20, 30, 40]
    assert estimated.tolist() == [False, True, True, True, False]


def test_leaves_a_four_year_gap_entirely_empty():
    # The old interpolate(limit=3) filled the first three years of this gap.
    original = series([0, NAN, NAN, NAN, NAN, 50])
    filled, estimated = bd.fill_short_gaps(original)
    assert as_list(filled) == [0, None, None, None, None, 50]
    assert not estimated.any()


def test_fills_short_gaps_but_not_long_ones_in_the_same_series():
    original = series([1, NAN, 3, NAN, NAN, NAN, NAN, NAN, 9, NAN, NAN, 12])
    filled, estimated = bd.fill_short_gaps(original)
    assert as_list(filled) == [1, 2, 3, None, None, None, None, None, 9, 10, 11, 12]
    assert [i for i, e in enumerate(estimated) if e] == [1, 9, 10]


def test_preserves_leading_and_trailing_missing_values():
    filled, estimated = bd.fill_short_gaps(series([NAN, NAN, 5, NAN, 7, NAN]))
    assert as_list(filled) == [None, None, 5, 6, 7, None]
    assert estimated.tolist() == [False, False, False, True, False, False]


def test_all_missing_series_stays_missing():
    filled, estimated = bd.fill_short_gaps(series([NAN, NAN, NAN]))
    assert as_list(filled) == [None, None, None]
    assert not estimated.any()


def test_gap_length_counts_years_without_a_row():
    # 2001 is missing and 2002-2005 have no rows at all: a five-year gap.
    long_gap = pd.Series([0, NAN, 6], index=[2000, 2001, 2006], dtype="float64")
    filled, estimated = bd.fill_short_gaps(long_gap)
    assert math.isnan(filled[2001])
    assert not estimated.any()

    # A two-year gap (2001-2002) with no 2002 row: interpolate by year.
    short_gap = pd.Series([0, NAN, 30], index=[2000, 2001, 2003], dtype="float64")
    filled, estimated = bd.fill_short_gaps(short_gap)
    assert filled[2001] == pytest.approx(10)
    assert estimated.tolist() == [False, True, False]


def frame(rows):
    return pd.DataFrame(rows, columns=["iso_code", "year", "population", "gdp_per_capita"])


def test_by_country_does_not_interpolate_across_countries():
    df = frame([
        ("AAA", 2000, 100, 1),
        ("AAA", 2001, NAN, NAN),
        ("BBB", 2000, NAN, 5),
        ("BBB", 2001, 300, NAN),
        ("BBB", 2002, NAN, 7),
    ])
    out = bd.fill_short_gaps_by_country(df).set_index(["iso_code", "year"])
    # AAA's trailing gap and BBB's leading gap must not borrow each other's values.
    assert math.isnan(out.loc[("AAA", 2001), "population"])
    assert math.isnan(out.loc[("BBB", 2000), "population"])
    assert out.loc[("BBB", 2001), "gdp_per_capita"] == pytest.approx(6)
    assert out["population_estimated"].sum() == 0
    assert out["gdp_per_capita_estimated"].tolist() == [False, False, False, True, False]


def test_export_flags_interpolated_years_only():
    years = list(range(bd.YEAR_START, bd.YEAR_END + 1))
    n = len(years)
    population = [1000.0] * n
    population[1] = NAN                     # one-year gap -> filled and flagged
    for i in range(10, 15):
        population[i] = NAN                 # five-year gap -> left empty
    gdp = [NAN] * n                         # no GDP at all -> no series, no flags

    df = pd.DataFrame({
        "iso_code": "AAA",
        "country": "Testland",
        "continent": "Europe",
        "year": years,
        "population": population,
        "gdp_per_capita": gdp,
        "co2": 1.0,
        "co2_per_capita": 1.0,
        "share_global_co2": 1.0,
        "renewables_share_energy": NAN,
    })
    payload = bd.to_columnar_json(bd.fill_short_gaps_by_country(df))

    assert payload["estimated"] == {"population": {"AAA": [1]}, "gdp_per_capita": {}}
    exported = payload["metrics"]["population"]["AAA"]
    assert exported[1] == 1000
    assert exported[10:15] == [None] * 5
    assert "AAA" not in payload["metrics"]["gdp_per_capita"]


def test_duplicate_country_years_stop_the_build():
    df = pd.DataFrame({"iso_code": ["AAA", "AAA", "BBB", None, None],
                       "year": [2000, 2000, 2000, 2000, 2000]})
    with pytest.raises(ValueError, match="energy: duplicate country-year records \\(AAA 2000\\)"):
        bd.assert_unique_country_years(df, "energy")
    # Regions without an ISO code may repeat; they are filtered out later.
    bd.assert_unique_country_years(df.iloc[2:], "energy")


def test_provenance_exports_retrieval_dates_and_checksums():
    entries = {"co2": {"name": "CO2", "homepage": "https://example.org", "license": "CC BY 4.0",
                       "url": "https://example.org/co2.csv", "version": "abc", "versionDate": "2026-06-02T16:33:39Z",
                       "sha256": "a" * 64, "bytes": 10, "retrievedAt": "2026-09-19T19:50:01Z"}}
    meta = bd.provenance(entries)
    assert meta["generator"]["pandas"] == pd.__version__
    assert meta["sources"] == [{"id": "co2", **{k: v for k, v in entries["co2"].items() if k != "bytes"}}]
    assert meta["generatedAt"].endswith("Z")
