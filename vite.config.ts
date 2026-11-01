import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/dishbrain-playground/',
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
