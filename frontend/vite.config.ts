import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { PRODUCT_NAME } from './src/config/product';

/** Matches the modules of the listed packages under node_modules, with either path separator. */
const packages = (...names: string[]) =>
  new RegExp(`[\\\\/]node_modules[\\\\/](${names.map((name) => name.replace('/', '[\\\\/]')).join('|')})[\\\\/]`);

export default defineConfig({
  plugins: [
    react(),
    // index.html names the product before the app loads and sets the workspace's own title.
    { name: 'product-name', transformIndexHtml: (html) => html.replaceAll('%PRODUCT_NAME%', PRODUCT_NAME) },
  ],
  build: {
    rolldownOptions: {
      output: {
        // Split the libraries that change only on a dependency bump away from the pages, so
        // a routine deploy invalidates the app chunks and leaves the vendor ones cached.
        // Each group also takes the dependencies of its packages. Anything used exclusively
        // by a lazy route stays in that route's chunk and is not pulled into the entry point.
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: packages('react', 'react-dom', 'react-router-dom') },
            { name: 'vendor-mui', test: packages('@mui/material', '@emotion/react', '@emotion/styled') },
            { name: 'vendor-grid', test: packages('ag-grid-community', 'ag-grid-react') },
            { name: 'vendor-query', test: packages('@tanstack/react-query') },
            // Loaded on demand by the first chart (workspace Budget tab, reports): never with the entry point.
            { name: 'vendor-charts', test: packages('ag-charts-community', 'ag-charts-react') },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    // Allow all hosts (lvh.me wildcard + platform admin testing)
    allowedHosts: true,
    // The sample data test reads one file of the backend fixtures (?raw).
    fs: { allow: ['.', '../backend/fixtures'] },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
});
