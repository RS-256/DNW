import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // resources.download.minecraft.net serves no CORS headers, so the ogg
      // files must be proxied. Production hosting needs an equivalent rewrite;
      // a Tauri shell can fetch directly.
      '/mc-res': {
        target: 'https://resources.download.minecraft.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mc-res/, ''),
      },
      // Client jar (block textures live inside it, not in the asset index).
      '/mc-data': {
        target: 'https://piston-data.mojang.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mc-data/, ''),
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
