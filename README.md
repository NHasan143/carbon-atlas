# Carbon Atlas

An interactive climate and energy explorer for comparing emissions, energy mix, economic output, and population across countries. The interface is titled **Climate & Energy Atlas** and uses data from Our World in Data.

The bundled dataset contains **217 countries and territories**, **35 years (1990–2024)**, and **six metrics**. Coverage varies by metric and year.

## Features

- **World map:** explore any metric on a choropleth map with country hover details.
- **Year controls:** scrub through time or play an animation that advances every 650 milliseconds.
- **Country comparisons:** select up to three countries, grouped by continent, with consistent comparison colors in the table, scatter plot, and trend charts.
- **Bubble chart:** choose the X and Y metrics, with bubble area representing population. GDP per capita and population axes use logarithmic scales.
- **Trend charts:** compare the full history of all six metrics, with a marker for the selected year.
- **Comparison table:** inspect all six metrics for the selected countries and year.
- **Automatic theme:** chart and interface colors follow the system's light or dark preference.

The initial view shows 2024 and compares the United States, China, and India.

## Hero video

Place your video at:

```text
public/videos/climate-atlas-hero.mp4
```

Use an MP4 with H.264 video, ideally 1920×1080, 10–20 seconds long, and below roughly 8–12 MB. A seamless loop works best. Keep the main subject near the center so the cover crop remains useful on mobile screens. The video is decorative, muted, loops automatically, and is hidden when a visitor prefers reduced motion. Until the file is added, the hero displays its dark fallback background.

The hero's **Donate** button links to [Our World in Data's official donation page](https://ourworldindata.org/donate), supporting the nonprofit source behind the atlas data. **Explore the atlas** scrolls to the year and country controls.

## Run locally

You need **Node.js 22.12.0 or newer** and npm (Node.js 24 LTS is recommended). Python is only needed if you want to rebuild the dataset.

```sh
git clone https://github.com/NHasan143/carbon-atlas.git
cd carbon-atlas
npm install
npm run dev
```

Open **http://localhost:4321** (or the address printed in the terminal). Astro automatically updates the browser when you edit the frontend. Stop the server with `Ctrl+C`.

In VS Code, open the project folder and run these commands in **Terminal → New Terminal**. A Python virtual environment is not required for the frontend. The old `python -m http.server 8000` command does not run the Astro source project.

Plotly, IBM Plex fonts, the dataset, and map geometry are all served from your app after installation; the dashboard no longer depends on a third-party CDN at runtime. If the chart library or dataset fails to load, the page displays an error and a reload link. Controls become available after initial chart rendering succeeds.

### Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server with live updates |
| `npm run check` | Check Astro components and TypeScript configuration |
| `npm run build` | Generate the static site in `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm test` | Run browser regression tests against the production build |

For a clean install using the committed dependency versions, use `npm ci`.

### Browser tests

Build the app, install Chromium once, and run the tests:

```sh
npm run build
npx playwright install chromium
npm test
```

You can also use an existing Chrome installation on macOS:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm test
```

The tests cover chart rendering, Play/Pause, year synchronization, all metric choices, country selection and empty-state recovery, dark/light themes, mobile layout, and loading errors. The test server runs on port 4322.

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
| GDP per capita | `gdp_per_capita` | International dollars (PPP, constant 2021) | 195 |
| Renewables share of energy | `renewables_share_energy` | Percent | 79 |
| Population | `population` | People | 216 |

GDP per capita comes directly from the World Bank's PPP series (constant 2021 international dollars). Renewables share refers to energy, not specifically electricity. Consult the upstream codebooks for detailed metric definitions and source methodology.

## Rebuild the dataset

The optional data pipeline requires Python 3, `pandas`, and `country_converter`. Use a virtual environment to keep these dependencies separate from your system Python:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install pandas country_converter
python build_dataset.py
```

On Windows PowerShell, activate the environment with `.venv\Scripts\Activate.ps1` instead.

The script downloads the [OWID CO₂ dataset](https://github.com/owid/co2-data), the [OWID energy dataset](https://github.com/owid/energy-data), and [World Bank GDP per capita via OWID](https://ourworldindata.org/grapher/gdp-per-capita-worldbank), caches them as `co2.csv`, `energy.csv`, and `gdp_worldbank.csv`, and overwrites `public/dataset.json`.

**Existing CSV files are reused.** To fetch newer upstream data, move or delete the three cached CSV files before rerunning the script. The year range remains fixed at 1990–2024 unless you edit `YEAR_START` and `YEAR_END` in `build_dataset.py`. If you change the range or coverage, update the static year labels and coverage text in `src/components/AtlasDashboard.astro`, `src/components/AtlasControls.astro`, and this README as well.

### Processing steps

1. Keep CO₂ records with an ISO code, excluding `OWID_` aggregate codes, within the configured year range.
2. Left-join energy data and World Bank GDP per capita on ISO code and year.
3. Sort each country's observations by year and apply pandas linear interpolation with `limit=3, limit_area="inside"` to population and GDP per capita. Only gaps between two reported values are filled; the last reported year is never carried forward. `limit=3` limits consecutive filled entries; it does not guarantee that only complete gaps of three years or fewer are filled.
4. Assign continent labels using `country_converter`.
5. Export country metadata and rounded metric arrays, omitting all-null country/metric series.
6. Calculate a fixed map color ceiling for each metric at approximately the 98th percentile of all available country-year values.

The pipeline does not interpolate emissions or renewables shares. It does not regenerate `public/world_110m.json`. Upstream data and dependency versions are not pinned, so rebuilding may produce a different snapshot.

### JSON structure

`public/dataset.json` uses a compact, column-oriented format:

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
├── src/
│   ├── components/       # Dashboard with its client script, plus shared UI
│   ├── layouts/          # HTML document, metadata, and local fonts
│   ├── pages/index.astro # Route composing the layout and dashboard
│   ├── env.d.ts          # Types for the Plotly distribution package
│   └── styles/global.css # Tailwind theme tokens and shared chart/table styles
├── public/
│   ├── dataset.json     # Bundled country/year metric data
│   └── world_110m.json   # Local TopoJSON geometry
├── tests/               # Playwright browser regression checks
├── astro.config.mjs     # Static output and Tailwind Vite integration
├── package.json         # Dependencies and development commands
├── package-lock.json    # Reproducible dependency versions
├── playwright.config.js
├── build_dataset.py     # Optional OWID data pipeline
└── README.md
```

The frontend uses **Astro 7.3.3**, **Tailwind CSS 4.3.3**, and **Plotly.js 2.35.2**. `AtlasDashboard.astro` owns the dashboard markup and a typed, bundled client script for data loading, chart rendering, and synchronized interactions. Astro generates static HTML and compiles the component's script to browser JavaScript without a React or Vue runtime. Tailwind uses its [official Vite integration for Astro](https://tailwindcss.com/docs/installation/framework-guides/astro). Plotly retains the existing version to preserve chart behavior and is bundled locally through npm.

## Static hosting

```sh
npm run build
```

Upload the **contents of `dist/`** to your static host. Keep the generated `_astro/` assets and JSON files together. No application server or database is required.

For a host that serves the project under a subdirectory (such as GitHub Pages at `/carbon-atlas/`), build with:

```sh
BASE_PATH=/carbon-atlas/ npm run build
```

The chart controller uses Astro's base URL for both dataset and map requests. The Python script only runs when regenerating the dataset; rebuild the frontend after changing public data before deploying.

## Interpretation notes

- Missing values appear as dashes in the table and uncolored countries on the map. Scatter points require both axis values; nonpositive values are excluded from logarithmic axes.
- The map scale is fixed across years for each metric and capped at its 98th-percentile ceiling. Values above the ceiling share the darkest color; the underlying dataset values are retained.
- Trend charts remove missing observations before drawing lines, so a line can connect across a period with no recorded data.
- Population and GDP per capita may contain interpolated values inside gaps. The exported JSON does not separately flag them.
- The bundled snapshot ends in 2024, the latest year with country-level emissions data, and is not refreshed automatically.

## Data sources and attribution

- [Our World in Data — CO₂ and Greenhouse Gas Emissions](https://github.com/owid/co2-data)
- [Our World in Data — Energy](https://github.com/owid/energy-data)
- [World Bank — GDP per capita, PPP (constant 2021 international $)](https://ourworldindata.org/grapher/gdp-per-capita-worldbank), via Our World in Data (CC BY 4.0)

Refer to the upstream repositories for citations, underlying providers, and applicable data reuse terms. The map asset is described in the application source as based on Natural Earth 110m data.

No license for this project's own code has been specified in the repository.
