import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../public/dataset.json', import.meta.url), 'utf8'));

async function openAtlas(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The planet, mapped.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Why it is getting warmer' })).toHaveAttribute('href', '/knowledge');
  await expect(page.getByRole('link', { name: /Donate via Wise/ })).toHaveAttribute('href', 'https://wise.com/pay/me/mdnaymulh4');
  const heroActions = await page.locator('.hero-actions a').allTextContents();
  expect(heroActions.map(label => label.trim())).toEqual(['Why it is getting warmer', 'Donate']);
  await expect(page.getByRole('heading', { name: 'Compare three countries' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The Comparison' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The World View' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'GDP, Emissions and Population' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The Trends Side by Side' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play animation' })).toBeEnabled({ timeout: 30000 });
  // Seven Plotly charts: the bubble chart and the six trends. The globe is Highcharts.
  await expect(page.locator('.js-plotly-plot')).toHaveCount(7);
  await expect(page.locator('#choroplethChart .highcharts-map-series path').first()).toBeVisible();
}

async function setYear(page, index) {
  await page.locator('#yearSlider').evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, index);
  await expect(page.locator('#yearReadout')).toHaveText(String(data.years[index]));
}

// The country slots are type-to-search comboboxes, not selects.
async function pickCountry(page, slot, query, iso) {
  const input = page.locator(`#cmp${slot}`);
  await input.click();
  await input.fill(query);
  await page.locator(`#cmp${slot}List [data-iso="${iso}"]`).click();
  await expect(page.locator(`#cmp${slot}Pop`)).toBeHidden();
}

async function clearCountry(page, slot) {
  const clear = page.locator(`#cmp${slot}Clear`);
  if (await clear.isVisible()) {
    await clear.click();
    await page.keyboard.press('Escape');
  }
}

test('renders locally and keeps Play, Pause, slider, table, map and trends synchronized', async ({ page }) => {
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:4322')) externalRequests.push(request.url());
  });
  await openAtlas(page);
  await expect(page.locator('#compareTable tbody tr')).toHaveCount(3);
  await expect(page.locator('#yearReadout')).toHaveText('2024');
  await page.getByRole('button', { name: 'Play animation' }).click();
  await expect(page.locator('#yearReadout')).not.toHaveText('2024');
  await page.getByRole('button', { name: 'Pause animation' }).click();
  const paused = await page.locator('#yearReadout').textContent();
  await page.waitForTimeout(850);
  await expect(page.locator('#yearReadout')).toHaveText(paused);
  await setYear(page, 10);
  await expect(page.locator('[data-year-output]')).toHaveText(['2000', '2000', '2000', '2000', '2000']);
  // The globe paints each country from the shared band ramp, so the rendered
  // fill is the band assertion: the six Level steps of the seq scale.
  const usa2000 = data.metrics.co2_per_capita.USA[10];
  const LEVEL_FILLS = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#184f95', '#0d366b'];
  const usaBand = [1, 2, 5, 10, 20].filter(edge => usa2000 >= edge).length;
  await expect(page.locator('#choroplethChart .highcharts-name-united-states').first())
    .toHaveAttribute('fill', LEVEL_FILLS[usaBand]);
  // A globe hides half the world, so the figure is read from the panel beside
  // it rather than from a tooltip that may be on the far side.
  await expect(page.locator('#choroFocus')).toContainText(usa2000.toFixed(2));
  expect(await page.locator('#sm-co2').evaluate(el => el.layout.shapes[0].x0)).toBe(2000);
  await expect(page.locator('#compareTable tbody tr').first()).toContainText(data.metrics.co2_per_capita.USA[10].toFixed(2));
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('all map and scatter metrics work and country selection recovers from empty', async ({ page }) => {
  await openAtlas(page);
  for (const metric of Object.keys(data.metricMeta)) {
    await page.selectOption('#choroMetric', metric);
    await expect(page.locator('#choroSub')).toContainText(data.metricMeta[metric].label);
    await page.selectOption('#scatterX', metric);
    await page.selectOption('#scatterY', metric);
    await expect.poll(() => page.locator('#scatterChart').evaluate(el => el.layout.xaxis.title.text)).toContain(data.metricMeta[metric].label);
    const expectedType = ['population', 'gdp_per_capita'].includes(metric) ? 'log' : 'linear';
    expect(await page.locator('#scatterChart').evaluate(el => el.layout.xaxis.type)).toBe(expectedType);
  }
  await pickCountry(page, 0, 'bangl', 'BGD');
  await expect(page.locator('#cmp0')).toHaveValue('Bangladesh');
  await expect(page.locator('#compareTable tbody tr').first()).toContainText('Bangladesh');

  // A three-letter code ranks first, and Enter takes the top match.
  await page.locator('#cmp1').click();
  await page.locator('#cmp1').fill('bgd');
  await expect(page.locator('#cmp1List [role="option"]').first()).toContainText('Bangladesh');
  // The list warns that the pick will empty the slot already holding it.
  await expect(page.locator('#cmp1List [data-iso="BGD"]')).toContainText('In country 1');
  await page.locator('#cmp1').press('Enter');
  await expect(page.locator('#cmp1')).toHaveValue('Bangladesh');
  await expect(page.locator('#cmp0')).toHaveValue('');
  await expect(page.locator('#compareTable tbody tr')).toHaveCount(2);

  for (const slot of [0, 1, 2]) await clearCountry(page, slot);
  await expect(page.locator('#compareEmpty')).toBeVisible();
  await expect(page.locator('#smGrid')).toContainText('Pick at least one country');
  await pickCountry(page, 0, 'usa', 'USA');
  await expect(page.locator('#compareEmpty')).toBeHidden();
  await expect(page.locator('#compareTable tbody tr')).toHaveCount(1);
  await expect(page.locator('#smGrid .js-plotly-plot')).toHaveCount(6);
  await setYear(page, 0);
});

test('country search filters by name, code and common alias, and is keyboard operable', async ({ page }) => {
  await openAtlas(page);
  const input = page.locator('#cmp0');
  const list = page.locator('#cmp0List');

  // Closed until asked for, and unfiltered it keeps the continent grouping.
  await expect(page.locator('#cmp0Pop')).toBeHidden();
  await input.click();
  await expect(list.locator('[role="option"]')).toHaveCount(data.countries.length);
  await expect(list.locator('[role="group"]')).toHaveCount(5);

  // A name people type but the dataset does not carry still resolves.
  await input.fill('holland');
  await expect(list.locator('[role="option"]')).toHaveCount(1);
  await expect(list.locator('[role="option"]').first()).toContainText('Netherlands');

  // Whole-name matches outrank substring matches.
  await input.fill('india');
  await expect(list.locator('[role="option"] .combo-name').first()).toHaveText('India');

  // Arrow keys move the active option and Enter commits it.
  await input.fill('ind');
  await input.press('ArrowDown');
  const second = await list.locator('[data-active="true"] .combo-name').textContent();
  await input.press('Enter');
  await expect(input).toHaveValue(second.trim());
  await expect(page.locator('#compareTable tbody tr').first()).toContainText(second.trim());

  // Nothing matched says so instead of showing an empty box.
  await input.click();
  await input.fill('zzzz');
  await expect(list.locator('[role="option"]')).toHaveCount(0);
  await expect(page.locator('#cmp0Empty')).toContainText('No country matches');

  // Escape abandons the typing and restores the committed country.
  await input.press('Escape');
  await expect(page.locator('#cmp0Pop')).toBeHidden();
  await expect(input).toHaveValue(second.trim());
});

test('a shared link restores every comparison choice and stays current as the view changes', async ({ page }) => {
  await page.goto('/?countries=BGD,,URY&year=2000&mapMetric=co2&xMetric=population&yMetric=share_global_co2&rankMetric=population&rankBasis=abs&view=change#controlsPanel');
  await expect(page.getByRole('button', { name: 'Share this view' })).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('#cmp0')).toHaveValue('Bangladesh');
  await expect(page.locator('#cmp1')).toHaveValue('');
  await expect(page.locator('#cmp2')).toHaveValue('Uruguay');
  await expect(page.locator('#yearReadout')).toHaveText('2000');
  await expect(page.locator('#choroMetric')).toHaveValue('co2');
  await expect(page.locator('#scatterX')).toHaveValue('population');
  await expect(page.locator('#scatterY')).toHaveValue('share_global_co2');
  await expect(page.locator('#rankMetric')).toHaveValue('population');
  await expect(page.getByRole('radio', { name: 'Change' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Amount' })).toBeChecked();
  await expect(page.locator('#compareTable tbody tr')).toHaveCount(2);

  await pickCountry(page, 1, 'china', 'CHN');
  await setYear(page, 11);
  await page.selectOption('#scatterX', 'gdp_per_capita');
  await page.getByRole('radio', { name: 'Percent' }).check();
  const current = new URL(page.url());
  expect(current.searchParams.get('countries')).toBe('BGD,CHN,URY');
  expect(current.searchParams.get('year')).toBe('2001');
  expect(current.searchParams.get('xMetric')).toBe('gdp_per_capita');
  expect(current.searchParams.get('rankBasis')).toBe('pct');
  expect(current.searchParams.get('view')).toBe('change');
  expect(current.hash).toBe('#controlsPanel');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async text => { window.__copiedAtlasLink = text; } },
    });
  });
  // Share opens a card of destinations; Copy link is one of them.
  await page.getByRole('button', { name: 'Share this view' }).click();
  await expect(page.locator('#sharePop')).toBeVisible();
  await expect(page.locator('#shareUrlPreview')).toHaveAttribute('title', page.url());
  await expect(page.locator('[data-share-target="x"]')).toHaveAttribute('target', '_blank');
  const shareHref = await page.locator('[data-share-target="facebook"]').getAttribute('href');
  expect(shareHref).toContain(encodeURIComponent(page.url()));
  await page.locator('#shareCopyBtn').click();
  await expect(page.locator('#shareViewStatus')).toHaveText('Link copied');
  expect(await page.evaluate(() => window.__copiedAtlasLink)).toBe(page.url());
  await page.keyboard.press('Escape');
  await expect(page.locator('#sharePop')).toBeHidden();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Share this view' })).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('#cmp1')).toHaveValue('China');
  await expect(page.locator('#yearReadout')).toHaveText('2001');
  await expect(page.locator('#scatterX')).toHaveValue('gdp_per_capita');
  await expect(page.getByRole('radio', { name: 'Percent' })).toBeChecked();
  await expect(page.locator('#compareTable tbody tr')).toHaveCount(3);
});

test('rankings order both ends of a metric and the movers since 1990', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openAtlas(page);

  const top = page.locator('#rankTopList .rank-row');
  const bottom = page.locator('#rankBottomList .rank-row');
  await expect(top).toHaveCount(10);
  await expect(bottom).toHaveCount(10);

  // The leader and the trailer are the real extremes of the reporting set.
  const co2pc = Object.entries(data.metrics.co2_per_capita)
    .map(([iso, series]) => [iso, series[series.length - 1]])
    .filter(([, v]) => v !== null && !Number.isNaN(v))
    .sort((a, b) => b[1] - a[1]);
  const nameOf = iso => data.countries.find(c => c.iso3 === iso).name;
  await expect(top.first()).toContainText(nameOf(co2pc[0][0]));
  await expect(bottom.first()).toContainText(nameOf(co2pc[co2pc.length - 1][0]));
  await expect(page.locator('#rankTopMeta')).toHaveText(`${co2pc.length} of ${data.countries.length} countries report`);

  // Highest and Lowest share one scale: the leader fills the row, the trailer barely registers.
  const scaleOf = sel => page.locator(sel).evaluate(el => Number(el.style.transform.replace(/[^0-9.]/g, '')));
  expect(await scaleOf('#rankTopList .rank-row:first-child .rank-fill')).toBeCloseTo(1, 2);
  expect(await scaleOf('#rankBottomList .rank-row:first-child .rank-fill')).toBeLessThan(0.02);

  // Every selected country is placed, whether or not it reaches a visible list.
  await expect(page.locator('#rankYours .rank-your-item')).toHaveCount(3);
  await expect(page.locator('#rankYours')).toContainText('highest of');

  // Percent scales each mover list to itself; Amount puts both on one scale.
  await expect(page.getByRole('radio', { name: 'Percent' })).toBeChecked();
  expect(await scaleOf('#rankRiseList .rank-row:first-child .rank-fill')).toBeCloseTo(1, 2);
  expect(await scaleOf('#rankFallList .rank-row:first-child .rank-fill')).toBeCloseTo(1, 2);
  await page.getByRole('radio', { name: 'Amount' }).check();
  await expect(page.locator('#rankRiseList .rank-row').first()).toContainText('+15.31 t');
  const rise = await scaleOf('#rankRiseList .rank-row:first-child .rank-fill');
  const fall = await scaleOf('#rankFallList .rank-row:first-child .rank-fill');
  expect(Math.max(rise, fall)).toBeCloseTo(1, 2);
  expect(Math.min(rise, fall)).toBeLessThan(0.95);

  // A share metric is held to percentage points, never a percent of a percent.
  await page.selectOption('#rankMetric', 'renewables_share_energy');
  await expect(page.getByRole('radio', { name: 'Percent' })).toBeDisabled();
  await expect(page.locator('#rankMoveSub')).toContainText('percentage points');
  await expect(page.locator('#rankTopList .rank-row').first()).toContainText('Iceland');

  // Level bars wear the map's six fixed bands: the leader sits in the top band,
  // the trailer in the palest one, so a bar's shade matches its shade on the map.
  await page.selectOption('#rankMetric', 'co2_per_capita');
  const fillOf = sel => page.locator(sel).evaluate(el => getComputedStyle(el).backgroundColor);
  const seq = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const hex = n => cs.getPropertyValue(`--seq-${n}`).trim();
    return { lowest: hex(100), highest: hex(700) };
  });
  const toRgb = h => `rgb(${[1,3,5].map(i => parseInt(h.slice(i, i+2), 16)).join(', ')})`;
  expect(await fillOf('#rankTopList .rank-row:first-child .rank-fill')).toBe(toRgb(seq.highest));
  expect(await fillOf('#rankBottomList .rank-row:first-child .rank-fill')).toBe(toRgb(seq.lowest));

  // A selected country is marked around the row in its own colour, since the
  // bar itself now carries the band rather than the country.
  await page.selectOption('#rankMetric', 'co2');
  await expect(page.locator('#rankTopList .rank-row[data-selected]').first()).toBeVisible();
  expect(await page.locator('#rankTopList .rank-row[data-selected]').first()
    .evaluate(el => el.style.getPropertyValue('--rank-mark'))).toMatch(/#|rgb/);

  // Rows leaving the visible ten fade out of flow; the list never drops below ten.
  await page.selectOption('#rankMetric', 'co2_per_capita');
  await page.getByRole('button', { name: 'Play animation' }).click();
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(150);
    expect(await page.locator('#rankTopList .rank-row:not([data-exit])').count()).toBe(10);
    expect(await page.locator('#rankYours .rank-your-item').count()).toBe(3);
  }
  await page.getByRole('button', { name: 'Pause animation' }).click();
  await expect.poll(() => page.locator('.rank-row[data-exit]').count()).toBe(0);

  // 1990 is the baseline, so the movers block says so instead of comparing it with itself.
  await page.selectOption('#rankMetric', 'co2_per_capita');
  await setYear(page, 0);
  await expect(page.locator('#rankMoversPair')).toBeHidden();
  await expect(page.locator('#rankMoveEmpty')).toContainText('Move the year past 1990');
  await expect(page.locator('#rankMoveSub')).toHaveText('');
  await setYear(page, 34);
  await expect(page.locator('#rankMoversPair')).toBeVisible();

  expect(errors).toEqual([]);
});

test('the map switches between level bands and change since 1990', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openAtlas(page);
  await expect(page.locator('#choroLegend')).toContainText('20+');
  await expect(page.locator('#choroLegend')).toContainText('No data');
  await expect(page.locator('#choroFocus')).toContainText('highest of');

  await page.getByRole('radio', { name: 'Change' }).check();
  await expect(page).toHaveURL(/view=change/);
  await expect(page.locator('#choroSub')).toContainText('since 1990');
  await expect(page.locator('#choroLegend')).toContainText('Within ±5%');
  await expect(page.locator('#choroLegend')).toContainText('better for the planet');
  const usa = data.metrics.co2_per_capita.USA;
  const change = (usa[usa.length - 1] - usa[0]) / usa[0] * 100;
  const focus = page.locator('#choroFocus');
  await expect(focus).toContainText('Since 1990');
  await expect(focus).toContainText(change < 0 ? 'better for the planet' : 'worse for the planet');

  // Share metrics change in percentage points; GDP and population are never judged.
  await page.selectOption('#choroMetric', 'renewables_share_energy');
  await expect(page.locator('#choroLegend')).toContainText('pts');
  await page.selectOption('#choroMetric', 'population');
  await expect(page.locator('#choroLegend')).toContainText('not better or worse');
  await expect(page.locator('#choroFocus')).not.toContainText('planet');

  await setYear(page, 0);
  await expect(page.locator('#choroFocus')).toContainText('Move the year past 1990');

  await page.getByRole('radio', { name: 'Level' }).check();
  await expect(page).not.toHaveURL(/view=change/);
  await page.goto('/?view=change');
  await expect(page.getByRole('radio', { name: 'Change' })).toBeChecked({ timeout: 30000 });
  await expect(page.locator('#choroSub')).toContainText('since 1990');
  expect(errors).toEqual([]);
});

test('clicking a country turns the globe to it and names it', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openAtlas(page);
  await page.locator('#worldMap').scrollIntoViewIfNeeded();
  await expect(page.locator('#choroFlag')).toBeHidden();

  await page.locator('#choroplethChart .highcharts-map-series .highcharts-name-egypt').first().click({ force: true });
  await expect(page.locator('#choroFlag')).toBeVisible();
  await expect(page.locator('#choroFlagImg')).toHaveAttribute('src', /\/flags\/eg\.svg$/);
  await expect(page.locator('#choroFlagName')).toHaveText('Egypt');

  // The globe turned: Egypt now sits near the centre of the disc rather than
  // wherever it happened to be. Measured against the sea, which is the globe.
  await expect.poll(async () => page.evaluate(() => {
    const sea = document.querySelector('#choroplethChart svg circle');
    const egypt = document.querySelector('#choroplethChart .highcharts-map-series .highcharts-name-egypt');
    if (!sea || !egypt) return 999;
    const s = sea.getBoundingClientRect(), e = egypt.getBoundingClientRect();
    const dx = (e.x + e.width / 2) - (s.x + s.width / 2);
    const dy = (e.y + e.height / 2) - (s.y + s.height / 2);
    return Math.round(Math.hypot(dx, dy) / (s.width / 2) * 100);
  }), { timeout: 10000 }).toBeLessThan(15);

  // The card restates a live figure, so it follows the year and the metric.
  const egypt2024 = data.metrics.co2_per_capita.EGY[data.years.length - 1];
  await expect(page.locator('#choroFlagValue')).toHaveText(egypt2024.toFixed(2) + ' t');
  await setYear(page, 10);
  await expect(page.locator('#choroFlagValue')).toHaveText(data.metrics.co2_per_capita.EGY[10].toFixed(2) + ' t');
  await page.selectOption('#choroMetric', 'population');
  await expect(page.locator('#choroFlagValue')).toHaveText(
    data.metrics.population.EGY[10].toLocaleString('en-US', { maximumFractionDigits: 0 }));
  await expect(page.locator('#choroFlagName')).toHaveText('Egypt');
  expect(errors).toEqual([]);
});

test('themes update chart colors and mobile layout remains usable', async ({ page }) => {
  await openAtlas(page);
  await page.screenshot({ path: 'test-results/atlas-desktop-light.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('#scatterChart').evaluate(el => el.layout.paper_bgcolor)).toBe('#1a1a19');
  await page.screenshot({ path: 'test-results/atlas-desktop-dark.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('#cmp0')).toBeVisible();
  await page.getByRole('button', { name: 'Play animation' }).click();
  await expect(page.locator('#yearReadout')).not.toHaveText('2024');
  await page.getByRole('button', { name: 'Pause animation' }).click();
  // The headless renderer cannot capture past ~8192px in one texture, and the
  // mobile page is taller than that, so the reference lands in two halves.
  const tall = await page.evaluate(() => document.documentElement.scrollHeight);
  const half = Math.ceil(tall / 2);
  for (const [i, y] of [0, half].entries()) {
    await page.screenshot({
      path: `test-results/atlas-mobile-dark-${i + 1}.png`,
      fullPage: true,
      clip: { x: 0, y, width: 390, height: Math.min(half, tall - y) },
    });
  }
});

// A tone generated here, so the test does not depend on the real track shipping.
function toneWav(seconds = 1, rate = 8000) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(2000 * Math.sin(2 * Math.PI * 220 * i / rate)), 44 + i * 2);
  return buf;
}

// The graph has no DOM element to inspect, so record the nodes as they are made.
async function probeAudio(page) {
  await page.addInitScript(() => {
    const Real = window.AudioContext;
    window.__sound = { ctxs: [], gains: [], loops: [] };
    window.AudioContext = class extends Real {
      constructor(...args) { super(...args); window.__sound.ctxs.push(this); }
      createGain() { const g = super.createGain(); window.__sound.gains.push(g); return g; }
      createBufferSource() {
        const s = super.createBufferSource();
        window.__sound.loops.push(s);
        return s;
      }
    };
  });
  const downloads = { count: 0 };
  page.on('request', request => {
    if (request.method() === 'GET' && request.url().includes('/audio/')) downloads.count += 1;
  });
  const read = () => page.evaluate(() => {
    const s = window.__sound;
    const ctx = s.ctxs[s.ctxs.length - 1];
    const gain = s.gains[s.gains.length - 1];
    const loop = s.loops[s.loops.length - 1];
    return {
      state: ctx ? ctx.state : null,
      gain: gain ? Number(gain.gain.value.toFixed(3)) : null,
      looping: loop ? loop.loop : null,
      seconds: loop && loop.buffer ? Math.round(loop.buffer.duration) : null,
      pressed: document.querySelector('[data-sound-toggle]').getAttribute('aria-pressed'),
      stored: localStorage.getItem('carbon-atlas:ambient'),
    };
  });
  return { read, downloads };
}

test('ambient sound stays silent until asked for, and remembers the answer', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/audio/*', route =>
    route.fulfill({ status: 200, body: toneWav(), contentType: 'audio/wav' }));
  const { read, downloads } = await probeAudio(page);

  await page.goto('/');
  const toggle = page.locator('[data-sound-toggle]');
  await expect(toggle).toBeVisible({ timeout: 15000 });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  // Nothing is fetched or played before the visitor asks for it.
  expect(downloads.count).toBe(0);
  expect((await read()).state).toBe(null);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await read()).gain, { timeout: 4000 }).toBeGreaterThan(0.1);
  const playing = await read();
  expect(playing.state).toBe('running');
  // Looping happens in the buffer, which is the only way it happens without a gap.
  expect(playing.looping).toBe(true);
  // Low enough to sit under a reading session.
  expect(playing.gain).toBeLessThanOrEqual(0.15);
  expect(downloads.count).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('carbon-atlas:ambient'))).toBe('on');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await read()).state, { timeout: 4000 }).toBe('suspended');
  expect((await read()).gain).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('carbon-atlas:ambient'))).toBe('off');

  // It must never sit on top of the back-to-top button.
  await page.evaluate(() => window.scrollTo(0, 3000));
  await expect(page.locator('[data-back-to-top]')).toBeVisible();
  const gap = await page.evaluate(() => {
    const s = document.querySelector('[data-sound-toggle]').getBoundingClientRect();
    const b = document.querySelector('[data-back-to-top]').getBoundingClientRect();
    return { gap: b.left - s.right, size: s.width };
  });
  expect(gap.gap).toBeGreaterThan(0);
  expect(gap.size).toBeGreaterThanOrEqual(44);
  expect(errors).toEqual([]);
});

test('Play starts the music, and an explicit mute outranks it', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/audio/*', route =>
    route.fulfill({ status: 200, body: toneWav(), contentType: 'audio/wav' }));
  const { read: sound, downloads } = await probeAudio(page);

  await openAtlas(page);
  await expect(page.locator('[data-sound-toggle]')).toBeVisible();
  // Nothing has been asked for yet, so nothing is fetched.
  expect(downloads.count).toBe(0);

  // Pressing Play is the gesture the browser wants, so the music may begin.
  await page.getByRole('button', { name: 'Play animation' }).click();
  await expect.poll(async () => (await sound()).pressed, { timeout: 5000 }).toBe('true');
  expect((await sound()).state).toBe('running');
  expect((await sound()).stored).toBe('on');

  // Pause stops the years, not the music: this is background sound, and the
  // speaker button is its off switch.
  await page.getByRole('button', { name: 'Pause animation' }).click();
  expect((await sound()).state).toBe('running');

  await page.locator('[data-sound-toggle]').click();
  await expect.poll(async () => (await sound()).state, { timeout: 4000 }).toBe('suspended');
  expect((await sound()).stored).toBe('off');

  // Play must not talk a muted visitor back into sound.
  await page.getByRole('button', { name: 'Play animation' }).click();
  await page.waitForTimeout(1200);
  expect(await sound()).toMatchObject({ state: 'suspended', pressed: 'false', stored: 'off' });
  await page.getByRole('button', { name: 'Pause animation' }).click();

  // And the refusal survives a reload.
  await page.reload();
  downloads.count = 0;
  await expect(page.getByRole('button', { name: 'Play animation' })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('button', { name: 'Play animation' }).click();
  await page.waitForTimeout(1200);
  expect(downloads.count).toBe(0);
  expect((await sound()).state).toBe(null);
  expect(errors).toEqual([]);
});

test('the sound control stays away when no track is installed', async ({ page }) => {
  await page.route('**/audio/*', route => route.fulfill({ status: 404, body: '' }));
  const { downloads } = await probeAudio(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Play animation' })).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('[data-sound-toggle]')).toBeHidden();
  expect(downloads.count).toBe(0);
});

test('the shipped loop is small, seamless and long enough to not repeat at you', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const { read } = await probeAudio(page);

  // No route stub here: this one checks the real file on disk.
  const bytes = await page.request.get('/audio/atlas-ambient.m4a');
  expect(bytes.ok()).toBe(true);
  const size = (await bytes.body()).length;
  expect(size).toBeLessThan(1_100_000);

  await page.goto('/');
  await expect(page.locator('[data-sound-toggle]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-sound-toggle]').click();
  await expect.poll(async () => (await read()).seconds, { timeout: 10000 }).toBeGreaterThanOrEqual(60);
  expect((await read()).seconds).toBeLessThanOrEqual(90);

  const track = await page.evaluate(() => {
    const loop = window.__sound.loops[window.__sound.loops.length - 1];
    const data = loop.buffer.getChannelData(0);
    const n = Math.round(loop.buffer.sampleRate * 0.25);
    const rms = from => {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += data[from + i] ** 2;
      return Math.sqrt(sum / n);
    };
    let peak = 0;
    let total = 0;
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
      total += data[i] * data[i];
    }
    let lead = 0;
    while (lead < data.length && Math.abs(data[lead]) < 1e-4) lead++;
    const db = v => 20 * Math.log10(v + 1e-9);
    return {
      head: db(rms(0)),
      tail: db(rms(data.length - n)),
      peak: db(peak),
      level: 10 * Math.log10(total / data.length),
      leadSilentMs: (lead / loop.buffer.sampleRate) * 1000,
    };
  });

  // The seam is a crossfade, so the two ends must line up in level: a loop that
  // lurches at the wrap is the one defect worth catching. Measured 5.2 dB.
  expect(Math.abs(track.head - track.tail)).toBeLessThan(8);
  // A container's encoder padding would show up here and tick every 75 seconds.
  expect(track.leadSilentMs).toBeLessThan(5);
  // The fader sits at 0.14, so a quietly mastered track lands near inaudible.
  // Any replacement has to arrive at roughly this level to be heard at all.
  expect(track.level).toBeGreaterThan(-30);
  expect(track.peak).toBeLessThan(-0.5);
  expect(errors).toEqual([]);
});

test('dataset failures show a recovery action and keep controls disabled', async ({ page }) => {
  await page.route('**/dataset.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/');
  await expect(page.locator('#loadStatus')).toContainText('atlas data could not load');
  await expect(page.getByRole('link', { name: 'Reload the atlas' })).toBeVisible();
  await expect(page.locator('#playBtn')).toBeDisabled();
  await page.unroute('**/dataset.json');
  await page.getByRole('link', { name: 'Reload the atlas' }).click();
  await expect(page.locator('#playBtn')).toBeEnabled({ timeout: 30000 });
});

test('a missing Plotly bundle shows a chart-library error', async ({ page }) => {
  await page.route('**/_astro/plotly*', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#loadStatus')).toContainText('chart library could not load');
  await expect(page.locator('#playBtn')).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Reload the atlas' })).toBeVisible();
});
