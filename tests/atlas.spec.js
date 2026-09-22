import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../public/dataset.json', import.meta.url), 'utf8'));

async function openAtlas(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The planet, mapped.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore the atlas' })).toHaveAttribute('href', '#controlsPanel');
  await expect(page.getByRole('link', { name: /Donate via Wise/ })).toHaveAttribute('href', 'https://wise.com/pay/me/mdnaymulh4');
  const heroActions = await page.locator('.hero-actions a').allTextContents();
  expect(heroActions.map(label => label.trim())).toEqual(['Explore the atlas', 'Donate']);
  await expect(page.getByRole('heading', { name: 'Compare three countries' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The Comparison' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The World View' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'GDP, Emissions and Population' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The Trends Side by Side' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play animation' })).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('.js-plotly-plot')).toHaveCount(8);
  await expect(page.locator('.choroplethlayer path').first()).toBeVisible();
}

async function setYear(page, index) {
  await page.locator('#yearSlider').evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, index);
  await expect(page.locator('#yearReadout')).toHaveText(String(data.years[index]));
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
  await expect(page.locator('[data-year-output]')).toHaveText(['2000', '2000', '2000', '2000']);
  const usaMap = await page.locator('#choroplethChart').evaluate(el => {
    const trace = el.data[0];
    const i = trace.locations.indexOf('USA');
    return { z: trace.z[i], detail: trace.customdata[i] };
  });
  const usa2000 = data.metrics.co2_per_capita.USA[10];
  expect(usaMap.detail).toContain(usa2000.toFixed(2));
  expect(usaMap.z).toBe([1, 2, 5, 10, 20].filter(edge => usa2000 >= edge).length + 0.5);
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
  await page.selectOption('#cmp0', 'BGD');
  await expect(page.locator('#compareTable tbody tr').first()).toContainText('Bangladesh');
  await page.selectOption('#cmp1', 'BGD');
  await expect(page.locator('#cmp0')).toHaveValue('');
  await expect(page.locator('#compareTable tbody tr')).toHaveCount(2);
  for (const slot of [0, 1, 2]) await page.selectOption(`#cmp${slot}`, '');
  await expect(page.locator('#compareEmpty')).toBeVisible();
  await expect(page.locator('#smGrid')).toContainText('Pick at least one country');
  await page.selectOption('#cmp0', 'USA');
  await expect(page.locator('#compareEmpty')).toBeHidden();
  await expect(page.locator('#compareTable tbody tr')).toHaveCount(1);
  await expect(page.locator('#smGrid .js-plotly-plot')).toHaveCount(6);
  await setYear(page, 0);
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
  const usaDetail = await page.locator('#choroplethChart').evaluate(el => el.data[0].customdata[el.data[0].locations.indexOf('USA')]);
  expect(usaDetail).toContain('since 1990');
  expect(usaDetail).toContain(change < 0 ? 'Better for the planet' : 'Worse for the planet');

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
  await page.screenshot({ path: 'test-results/atlas-mobile-dark.png', fullPage: true });
});

test('dataset failures show a recovery action and keep controls disabled', async ({ page }) => {
  await page.route('**/dataset.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('atlas data could not load');
  await expect(page.getByRole('link', { name: 'Reload the atlas' })).toBeVisible();
  await expect(page.locator('#playBtn')).toBeDisabled();
  await page.unroute('**/dataset.json');
  await page.getByRole('link', { name: 'Reload the atlas' }).click();
  await expect(page.locator('#playBtn')).toBeEnabled({ timeout: 30000 });
});

test('a missing Plotly bundle shows a chart-library error', async ({ page }) => {
  await page.route('**/_astro/plotly*', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('chart library could not load');
  await expect(page.locator('#playBtn')).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Reload the atlas' })).toBeVisible();
});
