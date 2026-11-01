import { defineConfig } from 'vite';

export default defineConfig({
  base: '/dishbrain-playground/',
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
