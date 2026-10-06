#!/usr/bin/env node
// Verifies the built site in dist/.
//
//   node scripts/verify-dist.mjs         # structural + offline checks
//   node scripts/verify-dist.mjs --git   # ...and fail if dist/ differs from what is committed
//
// CI runs a clean `npm run build` followed by `verify-dist --git`, so a pull request that
// changes source code without committing the regenerated dist/ fails.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { distDir, loadRegistry, repoRoot } from './lib/registry.mjs';

const registry = loadRegistry();
const errors = [];
const checkGit = process.argv.includes('--git');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  errors.push('dist/index.html (portal) is missing — run `npm run build`.');
} else {
  const files = walk(distDir);
  const rel = (f) => path.relative(distDir, f).split(path.sep).join('/');

  for (const tool of registry.tools) {
    if (!fs.existsSync(path.join(distDir, tool.id, 'index.html'))) {
      errors.push(`dist/${tool.id}/index.html is missing.`);
    }
  }

  const portal = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
  for (const tool of registry.tools.filter((t) => !t.hidden)) {
    if (!portal.includes(`href="./${tool.id}/"`)) {
      errors.push(`Portal does not link to ./${tool.id}/`);
    }
  }

  // External references are forbidden in markup and styles. (JavaScript bundles legitimately
  // contain URL *strings* — licence headers, specification links — so they are checked at
  // runtime by the browser tests and the Content-Security-Policy instead.)
  const externalRef =
    /(?:src|href|action|poster|data)\s*=\s*["']\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\/|@import\s+["']?(?:https?:)?\/\//i;
  const rootAbsoluteRef = /(?:src|href)\s*=\s*["']\/(?!\/)/i;
  for (const file of files) {
    const name = rel(file);
    if (/\.(html|css)$/.test(name)) {
      const text = fs.readFileSync(file, 'utf8');
      if (externalRef.test(text)) errors.push(`${name} references an external URL.`);
      if (rootAbsoluteRef.test(text)) {
        errors.push(`${name} uses a root-absolute path ("/…"); this breaks GitHub Pages subpaths.`);
      }
    }
    if (name.endsWith('.html')) {
      const text = fs.readFileSync(file, 'utf8');
      if (!text.includes('http-equiv="Content-Security-Policy"')) {
        errors.push(`${name} has no Content-Security-Policy meta tag.`);
      }
    }
    if (/\.(map)$/.test(name)) errors.push(`${name}: source maps should not be committed.`);
    if (/(^|\/)(\.DS_Store|Thumbs\.db)$/.test(name)) errors.push(`${name}: OS junk file.`);
  }

  const totalBytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
  console.log(`dist/: ${files.length} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MiB`);
}

if (checkGit) {
  const status = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all', '--', 'dist'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  ).trim();
  if (status) {
    errors.push(
      'The committed dist/ is stale — it differs from a clean build:\n' +
        status
          .split('\n')
          .slice(0, 40)
          .map((l) => '      ' + l)
          .join('\n') +
        '\n    Run `npm ci && npm run build` and commit the dist/ folder.',
    );
  }
}

if (errors.length) {
  console.error('✖ dist/ verification failed:\n  - ' + errors.join('\n  - '));
  process.exit(1);
}
console.log(`✔ dist/ verified${checkGit ? ' (matches committed output)' : ''}`);
