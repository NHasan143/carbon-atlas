import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  base: process.env.BASE_PATH || '/',
  vite: {
    plugins: [tailwindcss()],
    // Plotly's UMD distribution must be converted for the browser's ESM loader.
    optimizeDeps: { include: ['plotly.js-dist-min'] },
  },
});
