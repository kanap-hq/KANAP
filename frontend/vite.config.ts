import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split the libraries that change only on a dependency bump away from the pages, so
        // a routine deploy invalidates the app chunks and leaves the vendor ones cached.
        // Anything used exclusively by a lazy route stays in that route's chunk and is not
        // pulled into the entry point.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-mui': ['@mui/material', '@emotion/react', '@emotion/styled'],
          'vendor-grid': ['ag-grid-community', 'ag-grid-react'],
          'vendor-query': ['@tanstack/react-query'],
          // Loaded on demand by the first chart (workspace Budget tab, reports): never with the entry point.
          'vendor-charts': ['ag-charts-community', 'ag-charts-react'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    // Allow all hosts (lvh.me wildcard + platform admin testing)
    allowedHosts: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
});
