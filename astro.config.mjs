import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  // Social previews, the canonical URL and structured data need absolute URLs.
  // Production lives on Vercel; set SITE_URL to build for another origin.
  site: process.env.SITE_URL || 'https://carbon-atlas-brown.vercel.app',
  base: process.env.BASE_PATH || '/',
  vite: {
    plugins: [tailwindcss()],
    // Plotly's UMD distribution must be converted for the browser's ESM loader.
    optimizeDeps: { include: ['plotly.js-dist-min'] },
  },
});
