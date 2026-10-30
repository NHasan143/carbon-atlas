# Carbon Atlas

An interactive climate and energy explorer for comparing emissions, energy mix, economic output, and population across countries. It uses data from Our World in Data and the World Bank.

**Live site:** https://carbon-atlas-brown.vercel.app/

The bundled dataset contains **217 countries and territories**, **35 years (1990–2024)**, and **six metrics**. Coverage varies by metric and year.

## Frontend stack

The site remains an Astro static site. Its existing UI, animations, audio control, and charts use Astro components with typed browser scripts and Tailwind CSS v4. TypeScript is configured in strict mode.

React integration is available for new interactive islands. A typed, Tailwind-styled [button primitive](src/components/ui/button.tsx) uses Radix UI's `Slot` for `asChild` composition, and [components.json](components.json) configures the shadcn/ui CLI for future components. The current atlas controls have not been replaced, so adding this stack does not alter their appearance or behavior. Hydrate a new React component only when it needs client-side state, using an Astro `client:*` directive.

## Features

- **World map:** explore any metric on a choropleth map with country hover details.
- **Year controls:** scrub through time or play an animation that advances every 650 milliseconds.
- **Country comparisons:** select up to three countries, grouped by continent, with consistent comparison colors in the table, scatter plot, and trend charts.
- **Shareable views:** the URL keeps the chosen countries, year, map view, and metric selections; use **Share this view** below the country selectors to copy a link.
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

You need **Node.js 22.23.4 or newer** and npm (Node.js 24 LTS is recommended). Python is only needed if you want to rebuild the dataset.

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

The optional data pipeline needs Python 3.11 (see `.python-version`). Its dependencies are pinned exactly in `requirements.txt`, and `requirements-dev.txt` adds the test tools. Use a virtual environment to keep them separate from your system Python:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python build_dataset.py            # rebuild from the pinned sources
python validate_dataset.py         # check public/dataset.json
python -m pytest tests             # pipeline and validator tests
```

On Windows PowerShell, activate the environment with `.venv\Scripts\Activate.ps1` instead.

### Pinned sources

The pipeline reads the [OWID CO₂ dataset](https://github.com/owid/co2-data), the [OWID energy dataset](https://github.com/owid/energy-data), and [World Bank GDP per capita via OWID](https://ourworldindata.org/grapher/gdp-per-capita-worldbank), cached locally as `co2.csv`, `energy.csv`, and `gdp_worldbank.csv`.

`sources.lock.json` records exactly which version of each one the bundled dataset was built from. For the two OWID files, that is the upstream Git commit. For all three, it is a SHA-256 checksum, the file size, and the date the file was retrieved.

- **A normal build is reproducible.** It uses a cached CSV only if the CSV matches its checksum. A missing CSV is downloaded again from its pinned version and checked against the lock. A cached file that has changed, or an upstream URL that now serves different bytes, stops the build with instructions instead of silently using other data.
- **Refreshing is explicit.** `python build_dataset.py --refresh` downloads the latest upstream version of every source and re-pins it in `sources.lock.json`; `--refresh gdp` (or `co2`, `energy`) refreshes only the named ones. Commit the updated lock together with the rebuilt `public/dataset.json`, so every data change is reviewable.
- **The World Bank export has no version history,** so only its checksum pins it. If the upstream file changes, the pinned version cannot be downloaded again; refresh it to adopt the new data.

On macOS with the python.org installer, downloads fail certificate checks until you run **Install Certificates.command** from the Python folder in `/Applications`, or set `SSL_CERT_FILE=/etc/ssl/cert.pem`.

The year range remains fixed at 1990–2024 unless you edit `YEAR_START` and `YEAR_END` in `build_dataset.py`. If you change the range or coverage, update the static year labels and coverage text in `src/components/AtlasDashboard.astro`, `src/components/AtlasControls.astro`, and this README as well.

### Processing steps

1. Make every source available at its pinned version (see above).
2. Keep CO₂ records with an ISO code, excluding `OWID_` aggregate codes, within the configured year range.
3. Stop if any source repeats a country-year record; otherwise left-join energy data and World Bank GDP per capita on ISO code and year.
4. Within each country, linearly interpolate population and GDP per capita across interior gaps of three years or fewer. A gap is filled completely or not at all: longer gaps stay empty, and leading or trailing missing years are never filled, so the last reported year is never carried forward. Each filled value is recorded in `estimated`.
5. Assign continent labels using `country_converter`.
6. Export country metadata and rounded metric arrays, omitting all-null country/metric series.
7. Calculate a fixed map color ceiling for each metric at approximately the 98th percentile of all available country-year values.
8. Validate the result (below) and write `public/dataset.json` only if it passes.

The pipeline does not interpolate emissions or renewables shares. It does not regenerate `public/world_110m.json`.

### Validation

`validate_dataset.py` uses only the Python standard library. It runs at the end of every build and in CI against the committed `public/dataset.json`, and fails on:

- **Duplicate records:** a country listed twice, or a repeated key within any JSON object (such as a country appearing twice under one metric).
- **Series alignment:** years that are not consecutive, a series whose length differs from `years`, a series for a country missing from `countries`, an all-null series, or an `estimated` index outside the years or pointing at a missing value.
- **Finite values:** `NaN`, `Infinity`, or a non-numeric value in any series or scale ceiling.
- **Valid ranges:** negative values in any metric, and percentage metrics (unit `%`) above 100.
- **Provenance:** missing generation metadata, or source checksums, versions, URLs, or retrieval dates that differ from `sources.lock.json`.

### JSON structure

`public/dataset.json` uses a compact, column-oriented format:

| Key | Contents |
| --- | --- |
| `years` | Ordered array of years shared by every metric series |
| `countries` | Records containing `iso3`, `name`, and `continent` |
| `metrics` | Metric key → ISO-3 code → array of values aligned to `years` |
| `metricMeta` | Metric key → display `label`, `unit`, and map scale ceiling `vmax` |
| `estimated` | Interpolated metric key (`population`, `gdp_per_capita`) → ISO-3 code → indexes into `years` whose value was interpolated rather than reported. Countries with no interpolated values are omitted. |
| `meta` | `generatedAt` (UTC), the `generator` (script plus Python, pandas, and country_converter versions), and `sources`: for each source its name, homepage, license, exact download `url`, upstream `version` and `versionDate` where it has one, `sha256`, and `retrievedAt` |

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
├── tests/               # Playwright browser checks and data pipeline tests
├── astro.config.mjs     # Static output and Tailwind Vite integration
├── package.json         # Dependencies and development commands
├── package-lock.json    # Reproducible dependency versions
├── playwright.config.js
├── build_dataset.py     # Optional OWID data pipeline
├── dataset_sources.py   # Pinned upstream sources and --refresh
├── validate_dataset.py  # Dataset checks run by the build and CI
├── sources.lock.json    # Exact source versions, checksums, and retrieval dates
├── requirements.txt     # Pinned pipeline dependencies (requirements-dev.txt adds tests)
└── README.md
```

The frontend uses **Astro 7.4.4**, **Tailwind CSS 4.3.3**, and **Plotly.js 2.35.2**. `AtlasDashboard.astro` owns the dashboard markup and a typed, bundled client script for data loading, chart rendering, and synchronized interactions. Astro generates static HTML and compiles the component's script to browser JavaScript without a React or Vue runtime. Tailwind uses its [official Vite integration for Astro](https://tailwindcss.com/docs/installation/framework-guides/astro). Plotly retains the existing version to preserve chart behavior and is bundled locally through npm.

## Static hosting

```sh
npm run build
```

Upload the **contents of `dist/`** to your static host. Keep the generated `_astro/` assets and JSON files together. No application server or database is required.

For a host that serves the project under a subdirectory (such as GitHub Pages at `/carbon-atlas/`), build with:

```sh
BASE_PATH=/carbon-atlas/ npm run build
```

Link previews (Open Graph and X/Twitter cards), the canonical URL, and structured data use absolute URLs built from `SITE_URL` plus `BASE_PATH`. `SITE_URL` defaults to the production site, `https://carbon-atlas-brown.vercel.app`, which Vercel serves from the root, so no `BASE_PATH` is needed there. For any other host, set both to match the deployment:

```sh
SITE_URL=https://nhasan143.github.io BASE_PATH=/carbon-atlas/ npm run build
```

The social preview image is `public/og-image.jpg` (1200×630).

The chart controller uses Astro's base URL for both dataset and map requests. The Python script only runs when regenerating the dataset; rebuild the frontend after changing public data before deploying.

## Interpretation notes

- Missing values appear as dashes in the table and uncolored countries on the map. Scatter points require both axis values; nonpositive values are excluded from logarithmic axes.
- The map scale is fixed across years for each metric and capped at its 98th-percentile ceiling. Values above the ceiling share the darkest color; the underlying dataset values are retained.
- Trend charts remove missing observations before drawing lines, so a line can connect across a period with no recorded data.
- A selected country with no observations for a metric is named beneath that trend chart. If none of the selected countries has data, the chart is replaced by "No data available for the selected countries", the countries left out, and how many countries the metric covers.
- Population and GDP per capita may contain values interpolated across interior gaps of three years or fewer. `estimated` in the JSON lists each one; the dashboard does not mark them yet. The bundled snapshot has none.
- The bundled snapshot ends in 2024, the latest year with country-level emissions data, and is not refreshed automatically.

## Data sources and attribution

- [Our World in Data — CO₂ and Greenhouse Gas Emissions](https://github.com/owid/co2-data)
- [Our World in Data — Energy](https://github.com/owid/energy-data)
- [World Bank — GDP per capita, PPP (constant 2021 international $)](https://ourworldindata.org/grapher/gdp-per-capita-worldbank), via Our World in Data (CC BY 4.0)

Refer to the upstream repositories for citations, underlying providers, and applicable data reuse terms. The map asset is described in the application source as based on Natural Earth 110m data.

No license for this project's own code has been specified in the repository.
