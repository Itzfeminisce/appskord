import { defineConfig } from 'vite-plus';

// Workspace root for Vite+. Each app keeps its own wxt.config.ts and vitest.config.ts (WXT's Vitest plugin).
export default defineConfig({
  fmt: { singleQuote: true, printWidth: 120 },
  lint: { ignorePatterns: ['**/.output/**', '**/.wxt/**'] },
});
