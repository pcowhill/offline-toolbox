#!/usr/bin/env node
// Builds the complete static site into dist/: the portal at dist/index.html and every tool
// registered in tools.config.json at dist/<id>/index.html.
//
//   npm run build                 # build everything
//   npm run build -- pdf-toolbox  # rebuild only one tool (portal and other tools untouched)
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { createPortalConfig, createToolConfig } from './lib/vite-config.mjs';
import { collectNotices } from './lib/notices.mjs';
import { distDir, loadRegistry, unregisteredAppDirs } from './lib/registry.mjs';

const registry = loadRegistry();
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

for (const dir of unregisteredAppDirs(registry)) {
  console.warn(`⚠ apps/${dir} is not listed in tools.config.json and will not be built.`);
}

const started = Date.now();

if (only.length === 0) {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  console.log('\n▶ Building portal');
  await build({ ...createPortalConfig(), logLevel: 'warn' });
}

const targets = only.length ? only : registry.tools.map((t) => t.id);
for (const id of targets) {
  console.log(`▶ Building ${id}`);
  await build({ ...(await createToolConfig(id)), logLevel: 'warn' });
}

if (only.length === 0) {
  // Machine-readable manifest (handy for scripts on the isolated network).
  const manifest = {
    title: registry.site.title,
    tools: registry.tools.map(({ id, name, description }) => ({
      id,
      name,
      description,
      path: `./${id}/`,
    })),
  };
  fs.writeFileSync(path.join(distDir, 'tools.json'), JSON.stringify(manifest, null, 2) + '\n');
  // GitHub Pages: serve files verbatim (no Jekyll processing).
  fs.writeFileSync(path.join(distDir, '.nojekyll'), '');
  fs.copyFileSync(
    path.join(import.meta.dirname, 'OFFLINE-README.txt'),
    path.join(distDir, 'OFFLINE-README.txt'),
  );
  fs.copyFileSync(path.join(import.meta.dirname, 'serve.mjs'), path.join(distDir, 'serve.mjs'));
  const notices = collectNotices();
  fs.writeFileSync(path.join(distDir, 'THIRD-PARTY-NOTICES.txt'), notices.text);
  console.log(`  Wrote licence notices for ${notices.count} bundled packages`);
}

console.log(
  `\n✔ Built ${targets.length} tool(s) into dist/ in ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
