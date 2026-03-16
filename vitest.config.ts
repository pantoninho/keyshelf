import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        root: '.',
        exclude: ['test/e2e/**', 'node_modules/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'clover', 'json'],
            reportsDirectory: './coverage'
        }
    }
});
