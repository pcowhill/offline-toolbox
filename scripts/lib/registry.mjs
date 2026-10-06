// Reads and validates tools.config.json — the single registry of tools in this repository.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const appsDir = path.join(repoRoot, 'apps');
export const portalDir = path.join(repoRoot, 'portal');
export const sharedDir = path.join(repoRoot, 'shared');
export const distDir = path.join(repoRoot, 'dist');

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const RESERVED_IDS = new Set(['assets', 'shared', 'portal', 'index']);

/** @returns {{ site: { title: string, tagline: string }, tools: Array<Record<string, any>> }} */
export function loadRegistry() {
  const file = path.join(repoRoot, 'tools.config.json');
  const registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = [];
  const seen = new Set();
  if (!registry.site?.title) errors.push('site.title is required');
  if (!Array.isArray(registry.tools) || registry.tools.length === 0) {
    errors.push('tools must be a non-empty array');
  }
  for (const tool of registry.tools ?? []) {
    const where = `tool "${tool.id ?? '?'}"`;
    if (!ID_PATTERN.test(tool.id ?? '')) errors.push(`${where}: id must match ${ID_PATTERN}`);
    if (RESERVED_IDS.has(tool.id)) errors.push(`${where}: id is reserved`);
    if (seen.has(tool.id)) errors.push(`${where}: duplicate id`);
    seen.add(tool.id);
    for (const key of ['name', 'description', 'icon']) {
      if (typeof tool[key] !== 'string' || !tool[key])
        errors.push(`${where}: "${key}" is required`);
    }
    const dir = path.join(appsDir, tool.id ?? '');
    if (!fs.existsSync(path.join(dir, 'index.html'))) {
      errors.push(`${where}: apps/${tool.id}/index.html does not exist`);
    }
    if (tool.icon && !fs.existsSync(path.join(dir, tool.icon))) {
      errors.push(`${where}: icon apps/${tool.id}/${tool.icon} does not exist`);
    }
  }
  if (errors.length) {
    throw new Error(`Invalid tools.config.json:\n  - ${errors.join('\n  - ')}`);
  }
  return registry;
}

/** Directories in apps/ that are not registered — usually a forgotten registry entry. */
export function unregisteredAppDirs(registry) {
  if (!fs.existsSync(appsDir)) return [];
  const ids = new Set(registry.tools.map((t) => t.id));
  return fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !ids.has(d.name))
    .map((d) => d.name);
}
