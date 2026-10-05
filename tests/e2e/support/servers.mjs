// Starts the servers used by the end-to-end tests:
//   4173  dist/ served at the web root
//   4174  dist/ served under /offline-toolbox/ (GitHub Pages project-site layout)
//   4010  mock HTTP API for API Workbench
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../../scripts/serve.mjs';
import { startMockApi } from './mock-api.mjs';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist');
await startServer({ root: dist, port: 4173 });
await startServer({ root: dist, port: 4174, base: '/offline-toolbox/' });
await startMockApi(4010);
console.log('e2e servers ready: 4173 (root), 4174 (/offline-toolbox/), 4010 (mock API)');
