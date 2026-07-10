import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  // GitHub Pages serves this project site under /DNW/; dev stays at the root.
  // Assets are fetched from CORS-enabled hosts (jsDelivr mirror for sounds,
  // piston-data.mojang.com for the client jar), so no dev proxy is needed.
  base: command === 'build' ? '/DNW/' : '/',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}));
