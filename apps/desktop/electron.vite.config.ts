import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@murl/engine'] })],
    build: {
      rollupOptions: {
        external: ['playwright', 'node:sqlite'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@murl/engine'] })],
  },
  renderer: {
    plugins: [react()],
  },
});
