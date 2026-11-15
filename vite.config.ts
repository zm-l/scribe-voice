import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  clearScreen: false,
  envPrefix: ['VITE_'],
  optimizeDeps: {
    noDiscovery: true,
    include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    esbuildOptions: { tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', target: 'ES2022' } } },
  },
  build: { target: 'es2022' },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
