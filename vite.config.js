import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss()],
  base: '/infinite_doungen/',
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
  },
});
