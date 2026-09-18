# Carbon Atlas

An interactive climate and energy explorer for comparing emissions, energy mix, economic output, and population across countries. The interface is titled **Climate & Energy Atlas** and uses data from Our World in Data.

The bundled dataset contains **217 countries and territories**, **34 years (1990–2023)**, and **six metrics**. Coverage varies by metric and year.

## Features

- **World map:** explore any metric on a choropleth map with country hover details.
- **Year controls:** scrub through time or play an animation that advances every 650 milliseconds.
- **Country comparisons:** select up to three countries, grouped by continent, with consistent comparison colors in the table, scatter plot, and trend charts.
- **Bubble chart:** choose the X and Y metrics, with bubble area representing population. GDP per capita and population axes use logarithmic scales.
- **Trend charts:** compare the full history of five metrics, with a marker for the selected year.
- **Comparison table:** inspect all six metrics for the selected countries and year.
- **Automatic theme:** chart and interface colors follow the system's light or dark preference.

The initial view shows 2023 and compares the United States, China, and India.

## Run locally

You need Python 3 and a modern browser. The bundled data is ready to use; no build step, Node.js dependencies, or Python data-processing packages are required to serve the app.

```sh
git clone https://github.com/NHasan143/carbon-atlas.git
cd carbon-atlas
python3 -m http.server 8000
```

Open **http://localhost:8000**. Stop the server with `Ctrl+C`.

Serve the project over HTTP instead of opening `index.html` directly: the app fetches its JSON files using relative URLs. An internet connection is needed to load Plotly.js from cdnjs and the IBM Plex fonts from Google Fonts. The dataset and map geometry are served locally.

## Explore the atlas

1. Pick up to three countries using the comparison selectors. Selecting a country already chosen in another slot clears that earlier slot.
2. Move the year slider or press **Play** to update the map, scatter plot, table, and trend markers together.
3. Change the world map metric to compare its geographic distribution.
4. Choose metrics for the scatter plot's X and Y axes to explore their relationship.
5. Use the trend charts to compare longer-term changes.

## Metrics and coverage

These counts describe countries with at least one non-missing observation in the bundled snapshot; they do not imply complete coverage for every year.

| Metric | Dataset key | Unit | Countries with data |
| --- | --- | --- | ---: |
| CO₂ per capita | `co2_per_capita` | Tonnes per person | 213 |
| Total CO₂ emissions | `co2` | Million tonnes per year | 214 |
| Share of global CO₂ | `share_global_co2` | Percent | 214 |
| GDP per capita | `gdp_per_capita` | International dollars | 164 |
| Renewables share of energy | `renewables_share_energy` | Percent | 79 |
| Population | `population` | People | 216 |

GDP per capita is calculated as source GDP divided by population. Renewables share refers to energy, not specifically electricity. Consult the upstream codebooks for detailed metric definitions and source methodology.

## Rebuild the dataset

The optional data pipeline requires Python 3, `pandas`, and `country_converter`. Use a virtual environment to keep these dependencies separate from your system Python:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install pandas country_converter
python build_dataset.py
```

On Windows PowerShell, activate the environment with `.venv\Scripts\Activate.ps1` instead.

The script downloads the [OWID CO₂ dataset](https://github.com/owid/co2-data) and [OWID energy dataset](https://github.com/owid/energy-data), caches them as `co2.csv` and `energy.csv`, and overwrites `dataset.json`.

**Existing CSV files are reused.** To fetch newer upstream data, move or delete both cached CSV files before rerunning the script. The year range remains fixed at 1990–2023 unless you edit `YEAR_START` and `YEAR_END` in `build_dataset.py`. If you change the range or coverage, update the static year labels and coverage text in `index.html` and this README as well.

### Processing steps

1. Keep CO₂ records with an ISO code, excluding `OWID_` aggregate codes, within the configured year range.
2. Left-join energy data on ISO code and year.
3. Sort each country's observations by year and apply pandas linear interpolation with `limit=3` to population and GDP. This limits consecutive filled entries; it does not guarantee that only complete gaps of three years or fewer are filled.
4. Calculate GDP per capita and assign continent labels using `country_converter`.
5. Export country metadata and rounded metric arrays, omitting all-null country/metric series.
6. Calculate a fixed map color ceiling for each metric at approximately the 98th percentile of all available country-year values.

The pipeline does not interpolate emissions or renewables shares. It does not regenerate `world_110m.json`. Upstream data and dependency versions are not pinned, so rebuilding may produce a different snapshot.

### JSON structure

`dataset.json` uses a compact, column-oriented format:

| Key | Contents |
| --- | --- |
| `years` | Ordered array of years shared by every metric series |
| `countries` | Records containing `iso3`, `name`, and `continent` |
| `metrics` | Metric key → ISO-3 code → array of values aligned to `years` |
| `metricMeta` | Metric key → display `label`, `unit`, and map scale ceiling `vmax` |

A `null` array entry means that observation is missing. A country may be absent from a metric's dictionary when the entire series is missing.

## Project structure

```text
carbon-atlas/
├── index.html          # Page markup, styles, and interactive Plotly charts
├── dataset.json        # Bundled country/year metric data
├── world_110m.json      # Local TopoJSON geometry for the world map
├── build_dataset.py    # Optional OWID download and transformation pipeline
├── .gitignore          # Excludes local environments, caches, and raw downloads
└── README.md
```

The frontend uses plain HTML, CSS, and JavaScript with **Plotly.js 2.35.2**. There is no application server, database, or frontend build system.

## Static hosting

Upload `index.html`, `dataset.json`, and `world_110m.json` together to a static web host, preserving their relative paths. No server-side code is required. The Python script only runs when regenerating the dataset.

## Interpretation notes

- Missing values appear as dashes in the table and uncolored countries on the map. Scatter points require both axis values; nonpositive values are excluded from logarithmic axes.
- The map scale is fixed across years for each metric and capped at its 98th-percentile ceiling. Values above the ceiling share the darkest color; the underlying dataset values are retained.
- Trend charts remove missing observations before drawing lines, so a line can connect across a period with no recorded data.
- Population and GDP may contain interpolated values. The exported JSON does not separately flag them.
- The bundled snapshot ends in 2023 and is not refreshed automatically.

## Data sources and attribution

- [Our World in Data — CO₂ and Greenhouse Gas Emissions](https://github.com/owid/co2-data)
- [Our World in Data — Energy](https://github.com/owid/energy-data)

Refer to the upstream repositories for citations, underlying providers, and applicable data reuse terms. The map asset is described in the application source as based on Natural Earth 110m data.

No license for this project's own code has been specified in the repository.
