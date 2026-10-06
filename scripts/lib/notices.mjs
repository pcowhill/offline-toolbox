// Collects licence texts of every runtime dependency bundled into dist/ so the built site
// carries the notices that MIT/ISC/Apache-2.0 licences require.
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './registry.mjs';

function packageDir(name, from) {
  let dir = from;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function licenseText(dir) {
  const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  return file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : null;
}

export function collectNotices() {
  const root = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const seen = new Map();
  const queue = Object.keys(root.dependencies ?? {}).map((name) => [name, repoRoot]);
  while (queue.length) {
    const [name, from] = queue.shift();
    const dir = packageDir(name, from);
    if (!dir) continue;
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? 'see text',
      text: licenseText(dir),
      homepage: pkg.homepage ?? pkg.repository?.url ?? '',
    });
    for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push([dep, dir]);
  }
  const entries = [...seen.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
  const header =
    'THIRD-PARTY SOFTWARE NOTICES\n============================\n\n' +
    'The Offline Toolbox site bundles the following open-source packages.\n' +
    'pdf.js additionally ships font, character-map, colour-profile and WebAssembly data files\n' +
    'whose licences are included next to them in pdf-toolbox/pdfjs/.\n';
  const body = entries
    .map(
      (e) =>
        `\n${'-'.repeat(78)}\n${e.name} ${e.version} — ${e.license}\n${e.homepage}\n\n${e.text ?? `Licensed under ${e.license}.`}\n`,
    )
    .join('');
  return { text: header + body, count: entries.length };
}
