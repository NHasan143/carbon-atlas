"""
Climate & Energy Explorer — data pipeline
==========================================

Downloads Our World in Data's CO2/GHG emissions dataset, energy dataset and
World Bank GDP per capita series, merges them into one clean per-country/per-year table, and exports a compact
JSON file that powers an interactive explorer (animated choropleth, small
multiples, and a Gapminder-style scatter with a year slider).

Data sources (CC BY 4.0), pinned in sources.lock.json (see dataset_sources.py):
  https://github.com/owid/co2-data
  https://github.com/owid/energy-data
  https://ourworldindata.org/grapher/gdp-per-capita-worldbank (World Bank WDI)

Run:
    pip install -r requirements.txt
    python build_dataset.py                    # rebuild from the pinned sources
    python build_dataset.py --refresh          # move every source to its latest upstream version
    python build_dataset.py --refresh gdp      # ...or only the named ones

Produces:
    public/dataset.json — the merged, cleaned, columnar dataset used by the app,
    with a `meta` block recording how it was generated and from which sources.
"""

import argparse
import json
import platform
import sys
from pathlib import Path

import pandas as pd
import country_converter as coco

from dataset_sources import SOURCES, SourceError, ensure_sources, local_path, utc_now
from validate_dataset import validate

HERE = Path(__file__).parent
OUT_PATH = HERE / "public" / "dataset.json"

YEAR_START, YEAR_END = 1990, 2024

# Metric definitions: source column -> (json key, friendly label, unit, decimals)
METRICS = {
    "co2_per_capita":         ("CO2 per capita",            "t / person",  2),
    "co2":                    ("Total CO2 emissions",       "Mt / year",   1),
    "share_global_co2":       ("Share of global CO2",       "%",           2),
    "gdp_per_capita":         ("GDP per capita",             "2021 int-$", 0),
    "renewables_share_energy": ("Renewables share of energy", "%",         1),
    "population":             ("Population",                 "people",     0),
}

# Population and GDP per capita move smoothly year to year, so short interior
# gaps are safe to fill by linear interpolation. Emissions and renewables share
# are NOT interpolated: a gap there usually means the underlying survey doesn't
# exist for that country/year, and inventing a trend would misrepresent the
# source.
INTERPOLATED_METRICS = ("population", "gdp_per_capita")
MAX_GAP_YEARS = 3


def fill_short_gaps(series: pd.Series, max_gap: int = MAX_GAP_YEARS) -> tuple[pd.Series, pd.Series]:
    """Linearly fill interior gaps that are `max_gap` years long or shorter.

    `series` is one country's values indexed by year, in ascending order.
    A gap is measured in years between the reported values on either side,
    so a gap is filled completely or not at all. Leading and trailing
    missing values are never filled. Returns the filled series and a
    boolean mask marking the filled (estimated) entries.
    """
    years = pd.Series(series.index, index=series.index, dtype="float64")
    reported_years = years.where(series.notna())
    gap_years = reported_years.bfill() - reported_years.ffill() - 1
    # NaN gap lengths (leading/trailing runs) compare as False, so stay unfilled.
    estimated = series.isna() & (gap_years <= max_gap)
    interpolated = series.interpolate(method="index", limit_area="inside")
    return series.where(~estimated, interpolated), estimated


def fill_short_gaps_by_country(df: pd.DataFrame, columns=INTERPOLATED_METRICS) -> pd.DataFrame:
    """Apply fill_short_gaps to each country's series.

    Adds a boolean `<column>_estimated` column for every filled column.
    """
    df = df.sort_values(["iso_code", "year"]).copy()
    for col in columns:
        df[col] = df[col].astype("float64")
        df[f"{col}_estimated"] = False
        for _, rows in df.groupby("iso_code").groups.items():
            by_year = pd.Series(df.loc[rows, col].to_numpy(), index=df.loc[rows, "year"].to_numpy())
            filled, estimated = fill_short_gaps(by_year)
            df.loc[rows, col] = filled.to_numpy()
            df.loc[rows, f"{col}_estimated"] = estimated.to_numpy()
    return df


def assert_unique_country_years(df: pd.DataFrame, label: str) -> None:
    """Fail if any country has more than one row for a year.

    A repeated key in a source would multiply rows on merge, and the export
    would then keep whichever duplicate came last without saying so.
    Rows with no ISO code (regions and aggregates) are ignored here.
    """
    keyed = df[df["iso_code"].notna()]
    dupes = keyed[keyed.duplicated(["iso_code", "year"], keep=False)]
    if not dupes.empty:
        examples = ", ".join(f"{iso} {year}" for iso, year in
                             dupes[["iso_code", "year"]].drop_duplicates().head(5).itertuples(index=False))
        raise ValueError(f"{label}: duplicate country-year records ({examples})")


def load_source_data() -> pd.DataFrame:
    co2 = pd.read_csv(
        local_path("co2"),
        usecols=["country", "year", "iso_code", "population", "co2",
                 "co2_per_capita", "share_global_co2"],
    )
    energy = pd.read_csv(
        local_path("energy"),
        usecols=["iso_code", "year", "renewables_share_energy"],
    )

    # --- Keep real countries only -----------------------------------------
    # OWID includes continents, income groups and the World total as rows.
    # They either have no iso_code, or (World, EU27, ...) an "OWID_" one.
    co2 = co2[co2["iso_code"].notna() & ~co2["iso_code"].str.startswith("OWID_", na=False)]
    co2 = co2[(co2["year"] >= YEAR_START) & (co2["year"] <= YEAR_END)]

    gdp = pd.read_csv(local_path("gdp"), usecols=["code", "year", "ny_gdp_pcap_pp_kd"]).rename(
        columns={"code": "iso_code", "ny_gdp_pcap_pp_kd": "gdp_per_capita"}
    )

    for label, frame in (("co2", co2), ("energy", energy), ("gdp", gdp)):
        assert_unique_country_years(frame, label)
    df = (co2.merge(energy, on=["iso_code", "year"], how="left")
             .merge(gdp, on=["iso_code", "year"], how="left"))
    assert_unique_country_years(df, "merged")

    # --- Handle missing data -------------------------------------------------
    # Fill only complete interior gaps of MAX_GAP_YEARS or fewer, within each
    # country's own series. Longer gaps stay empty, and the last reported year
    # is never carried forward into years the source hasn't published.
    df = fill_short_gaps_by_country(df)

    # --- Continent, for grouping the country picker --------------------------
    iso3_list = df["iso_code"].unique().tolist()
    continents = coco.convert(names=iso3_list, src="ISO3", to="continent", not_found=None)
    continent_map = dict(zip(iso3_list, continents))
    df["continent"] = df["iso_code"].map(continent_map)

    return df


def to_columnar_json(df: pd.DataFrame) -> dict:
    years = list(range(YEAR_START, YEAR_END + 1))
    year_index = {y: i for i, y in enumerate(years)}

    countries = (
        df[["iso_code", "country", "continent"]]
        .drop_duplicates("iso_code")
        .dropna(subset=["continent"])
        .query("continent != 'Antarctica'")  # research stations, not an economy
        .sort_values("country")
    )
    keep_iso = set(countries["iso_code"])

    metrics_out = {m: {} for m in METRICS}
    # Metric -> ISO-3 -> indexes into `years` whose value was interpolated.
    estimated_out = {m: {} for m in INTERPOLATED_METRICS}
    for iso, g in df[df["iso_code"].isin(keep_iso)].groupby("iso_code"):
        g = g.set_index("year")
        for col, (_, _, decimals) in METRICS.items():
            arr = [None] * len(years)
            for yr, val in g[col].items():
                if yr in year_index and pd.notna(val):
                    arr[year_index[yr]] = round(float(val), decimals) if decimals > 0 else int(round(val))
            # skip all-null series entirely to keep the file small
            if any(v is not None for v in arr):
                metrics_out[col][iso] = arr
        for col in INTERPOLATED_METRICS:
            flag_col = f"{col}_estimated"
            if flag_col not in g:
                continue
            flagged = [year_index[yr] for yr, is_est in g[flag_col].items()
                       if is_est and yr in year_index]
            if flagged:
                estimated_out[col][iso] = sorted(flagged)

    country_records = [
        {"iso3": r.iso_code, "name": r.country, "continent": r.continent}
        for r in countries.itertuples()
    ]

    # A fixed color-scale ceiling per metric, capped at the 98th percentile of
    # all country-year values. A handful of petrostates and city-states are
    # extreme outliers (e.g. CO2 per capita above 300 t in some small
    # LNG-exporting economies some years) — coloring the whole map off their
    # scale would wash out the other ~95% of countries into a single pale
    # shade, so those outliers are shown pinned to the darkest color instead.
    metric_meta = {}
    for key, (label, unit, _) in METRICS.items():
        all_vals = sorted(
            v for arr in metrics_out[key].values() for v in arr if v is not None
        )
        vmax = all_vals[int(0.98 * (len(all_vals) - 1))] if all_vals else 1
        metric_meta[key] = {"label": label, "unit": unit, "vmax": vmax}

    return {
        "years": years,
        "countries": country_records,
        "metrics": metrics_out,
        "metricMeta": metric_meta,
        "estimated": estimated_out,
    }


def provenance(source_entries: dict[str, dict]) -> dict:
    """How and from what this dataset was generated."""
    return {
        "generatedAt": utc_now(),
        "generator": {
            "script": "build_dataset.py",
            "python": platform.python_version(),
            "pandas": pd.__version__,
            "country_converter": coco.__version__,
        },
        "sources": [
            {"id": sid, **{k: entry[k] for k in
                           ("name", "homepage", "license", "url", "version",
                            "versionDate", "sha256", "retrievedAt")}}
            for sid, entry in source_entries.items()
        ],
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rebuild public/dataset.json from the sources pinned in sources.lock.json.")
    parser.add_argument(
        "--refresh", nargs="*", metavar="SOURCE", choices=sorted(SOURCES),
        help=("download the latest upstream version of the named sources "
              f"({', '.join(sorted(SOURCES))}), or of all of them when none are named, "
              "and re-pin them in sources.lock.json"))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    refresh = None if args.refresh is None else (set(args.refresh) or set(SOURCES))
    try:
        source_entries = ensure_sources(refresh)
    except SourceError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    df = load_source_data()
    payload = to_columnar_json(df)
    payload["meta"] = provenance(source_entries)

    errors = validate(payload, {"sources": source_entries})
    if errors:
        print(f"error: the rebuilt dataset failed validation; {OUT_PATH.name} was not written.", file=sys.stderr)
        for line in errors:
            print(f"  {line}", file=sys.stderr)
        return 1

    out_path = OUT_PATH
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))

    for sid, entry in source_entries.items():
        version = f"@{entry['version'][:7]}" if entry.get("version") else ""
        print(f"Source {sid}{version}: sha256 {entry['sha256'][:12]}…, retrieved {entry['retrievedAt']}")
    n_countries = len(payload["countries"])
    n_with_renew = len(payload["metrics"]["renewables_share_energy"])
    print(f"Countries: {n_countries}")
    print(f"Years: {payload['years'][0]}-{payload['years'][-1]}")
    print(f"Countries with renewables-share data: {n_with_renew}")
    for col, by_iso in payload["estimated"].items():
        n_est = sum(len(idx) for idx in by_iso.values())
        print(f"Interpolated {col} values: {n_est} across {len(by_iso)} countries")
    print(f"Wrote {out_path} ({out_path.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
