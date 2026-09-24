// Regenerates public/flags/ and src/data/country-flags.json from the dataset.
// Run after build_dataset.py changes the country list:  node scripts/build-flags.mjs
import countries from 'i18n-iso-countries';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';

const data = JSON.parse(readFileSync('public/dataset.json', 'utf8'));
const map = {};
const missing = [];

rmSync('public/flags', { recursive: true, force: true });
mkdirSync('public/flags', { recursive: true });

for (const country of data.countries) {
  const alpha2 = countries.alpha3ToAlpha2(country.iso3);
  const source = alpha2 && `node_modules/flag-icons/flags/4x3/${alpha2.toLowerCase()}.svg`;
  if (!source || !existsSync(source)) {
    missing.push(`${country.iso3} ${country.name}`);
    continue;
  }
  map[country.iso3] = alpha2.toLowerCase();
  copyFileSync(source, `public/flags/${alpha2.toLowerCase()}.svg`);
}

writeFileSync('src/data/country-flags.json', JSON.stringify(map) + '\n');
console.log(`flags: ${Object.keys(map).length}/${data.countries.length}`);
if (missing.length) console.log('no flag for:', missing.join(', '));
