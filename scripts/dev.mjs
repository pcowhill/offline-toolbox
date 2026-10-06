#!/usr/bin/env node
// Starts a Vite dev server (hot reload) for one tool, or for the portal.
//
//   npm run dev -- api-workbench
//   npm run dev -- pdf-toolbox
//   npm run dev               # portal only (tool links work after `npm run build`)
import { createServer } from 'vite';
import { createPortalConfig, createToolConfig } from './lib/vite-config.mjs';
import { loadRegistry } from './lib/registry.mjs';

const id = process.argv[2];
const registry = loadRegistry();
if (id && !registry.tools.some((t) => t.id === id)) {
  console.error(`Unknown tool "${id}". Available: ${registry.tools.map((t) => t.id).join(', ')}`);
  process.exit(1);
}
const config = id ? await createToolConfig(id) : createPortalConfig();
const server = await createServer({ ...config, server: { ...config.server, port: 5173 } });
await server.listen();
server.printUrls();
