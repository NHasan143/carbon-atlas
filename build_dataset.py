"""
Climate & Energy Explorer — data pipeline
==========================================

Downloads Our World in Data's CO2/GHG emissions dataset, energy dataset and
World Bank GDP per capita series, merges them into one clean per-country/per-year table, and exports a compact
JSON file that powers an interactive explorer (animated choropleth, small
multiples, and a Gapminder-style scatter with a year slider).

Data sources (public domain / CC BY, refreshed daily by OWID):
  https://github.com/owid/co2-data
  https://github.com/owid/energy-data
  https://ourworldindata.org/grapher/gdp-per-capita-worldbank (World Bank WDI, CC BY 4.0)

Run:
    pip install pandas country_converter
    python3 build_dataset.py

Produces:
    public/dataset.json — the merged, cleaned, columnar dataset used by the app
"""

import json
import urllib.request
from pathlib import Path

import pandas as pd
import country_converter as coco

HERE = Path(__file__).parent
CO2_URL = "https://raw.githubusercontent.com/owid/co2-data/master/owid-co2-data.csv"
ENERGY_URL = "https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv"
CO2_LOCAL = HERE / "co2.csv"
ENERGY_LOCAL = HERE / "energy.csv"
# World Bank GDP per capita, PPP (constant 2021 international $), via OWID.
# It runs to the latest year for ~200 countries, where OWID's co2-data GDP
# (Maddison Project) stops earlier and covers fewer countries.
GDP_URL = ("https://ourworldindata.org/grapher/gdp-per-capita-worldbank.csv"
           "?v=1&csvType=full&useColumnShortNames=true")
GDP_LOCAL = HERE / "gdp_worldbank.csv"

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


def fetch_if_missing(url: str, dest: Path) -> None:
    if dest.exists():
        return
    print(f"Downloading {url} -> {dest}")
    # ourworldindata.org rejects urllib's default user agent.
    request = urllib.request.Request(url, headers={"User-Agent": "carbon-atlas-build/1.0"})
    with urllib.request.urlopen(request) as response:
        dest.write_bytes(response.read())


def load_source_data() -> pd.DataFrame:
    fetch_if_missing(CO2_URL, CO2_LOCAL)
    fetch_if_missing(ENERGY_URL, ENERGY_LOCAL)
    fetch_if_missing(GDP_URL, GDP_LOCAL)

    co2 = pd.read_csv(
        CO2_LOCAL,
        usecols=["country", "year", "iso_code", "population", "co2",
                 "co2_per_capita", "share_global_co2"],
    )
    energy = pd.read_csv(
        ENERGY_LOCAL,
        usecols=["iso_code", "year", "renewables_share_energy"],
    )

    # --- Keep real countries only -----------------------------------------
    # OWID includes continents, income groups and the World total as rows.
    # They either have no iso_code, or (World, EU27, ...) an "OWID_" one.
    co2 = co2[co2["iso_code"].notna() & ~co2["iso_code"].str.startswith("OWID_")]
    co2 = co2[(co2["year"] >= YEAR_START) & (co2["year"] <= YEAR_END)]

    gdp = pd.read_csv(GDP_LOCAL, usecols=["code", "year", "ny_gdp_pcap_pp_kd"]).rename(
        columns={"code": "iso_code", "ny_gdp_pcap_pp_kd": "gdp_per_capita"}
    )

    df = (co2.merge(energy, on=["iso_code", "year"], how="left")
             .merge(gdp, on=["iso_code", "year"], how="left"))

    # --- Handle missing data -------------------------------------------------
    # Population and GDP per capita move smoothly year to year, so short
    # interior gaps (<=3 yrs) are safe to fill by linear interpolation within
    # each country's own series. limit_area="inside" keeps this to gaps
    # between two real values: the last reported year is never carried
    # forward into years the source hasn't published. Emissions and
    # renewables-share are NOT interpolated: a gap there usually means the
    # underlying survey doesn't exist for that country/year, and inventing a
    # trend would misrepresent the source.
    df = df.sort_values(["iso_code", "year"])
    for col in ("population", "gdp_per_capita"):
        df[col] = df.groupby("iso_code")[col].transform(
            lambda s: s.interpolate(limit=3, limit_area="inside")
        )

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
    }


def main() -> None:
    df = load_source_data()
    payload = to_columnar_json(df)

    out_path = HERE / "public" / "dataset.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, separators=(",", ":")))

    n_countries = len(payload["countries"])
    n_with_renew = len(payload["metrics"]["renewables_share_energy"])
    print(f"Countries: {n_countries}")
    print(f"Years: {payload['years'][0]}-{payload['years'][-1]}")
    print(f"Countries with renewables-share data: {n_with_renew}")
    print(f"Wrote {out_path} ({out_path.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
