// Shared Vite configuration used for the portal and every tool.
//
// Every tool is built as an independent static site with a *relative* base ("./"), so the
// output works at any URL prefix: the GitHub Pages project subpath (/<repo>/<tool>/), the
// root of a local web server (/<tool>/), or any other directory on an intranet server.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import react from '@vitejs/plugin-react';
import { mergeConfig } from 'vite';
import { appsDir, loadRegistry, portalDir, repoRoot, sharedDir } from './registry.mjs';

// Applies the saved theme before first paint so there is no light/dark flash.
const THEME_BOOTSTRAP =
  "(function(){try{var t=localStorage.getItem('offline-toolbox:theme');" +
  "if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();";
const THEME_BOOTSTRAP_HASH = crypto.createHash('sha256').update(THEME_BOOTSTRAP).digest('base64');

/**
 * Default Content-Security-Policy. It is the browser-enforced guarantee that the built site
 * never loads code, styles, fonts or images from another host. Tools may append sources via
 * the "csp" field in tools.config.json (e.g. API Workbench needs connect-src http: https:).
 */
export function buildCsp(extra = {}) {
  const policy = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'wasm-unsafe-eval'", `'sha256-${THEME_BOOTSTRAP_HASH}'`],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", 'data:', 'blob:'],
    'worker-src': ["'self'", 'blob:'],
    'media-src': ["'self'", 'data:', 'blob:'],
    'frame-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'none'"],
  };
  for (const [directive, sources] of Object.entries(extra)) {
    policy[directive] = [...new Set([...(policy[directive] ?? []), ...sources])];
  }
  return Object.entries(policy)
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Injects theme bootstrap, CSP and privacy meta tags into every HTML entry point. */
function toolboxHtmlPlugin({ csp }) {
  return {
    name: 'offline-toolbox:html',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const isBuild = !ctx.server;
        // The dev server needs inline scripts/websockets for hot reload, so CSP is build-only.
        const injected = [
          isBuild
            ? `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}" />`
            : '',
          '<meta name="referrer" content="no-referrer" />',
          `<script>${THEME_BOOTSTRAP}</script>`,
        ]
          .filter(Boolean)
          .map((line) => `\n    ${line}`)
          .join('');
        // Insert directly after <meta charset> so the policy governs every later element.
        const charset = /<meta\s+charset=["']?[\w-]+["']?\s*\/?>/i;
        if (!charset.test(html)) throw new Error('HTML entry points must declare <meta charset>');
        return html.replace(charset, (match) => match + injected);
      },
    },
  };
}

/** Renders the portal's tool cards from tools.config.json (single source of truth). */
function portalCardsPlugin(registry) {
  return {
    name: 'offline-toolbox:portal-cards',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const cards = registry.tools
          .filter((tool) => !tool.hidden)
          .map((tool) => {
            const href = `./${tool.id}/`;
            const icon = path.posix.join('..', 'apps', tool.id, tool.icon);
            const tags = (tool.tags ?? []).map((tag) => `<li>${escapeHtml(tag)}</li>`).join('');
            return `
        <li class="tool-card" style="--tool-accent: ${escapeHtml(tool.accent ?? '#2563eb')}" data-tool-id="${escapeHtml(tool.id)}">
          <a class="tool-card__link" href="${href}">
            <img class="tool-card__icon" src="${icon}" alt="" width="56" height="56" />
            <span class="tool-card__body">
              <span class="tool-card__name">${escapeHtml(tool.name)}</span>
              <span class="tool-card__description">${escapeHtml(tool.description)}</span>
              <ul class="tool-card__tags" aria-label="Tags">${tags}</ul>
            </span>
            <span class="tool-card__launch" aria-hidden="true">Open →</span>
          </a>
        </li>`;
          })
          .join('');
        return html
          .replace('<!--TOOL_CARDS-->', cards)
          .replaceAll('%SITE_TITLE%', escapeHtml(registry.site.title))
          .replaceAll('%SITE_TAGLINE%', escapeHtml(registry.site.tagline))
          .replaceAll('%TOOL_COUNT%', String(registry.tools.filter((t) => !t.hidden).length));
      },
    },
  };
}

function baseConfig({ root, outDir, emptyOutDir, csp, extraPlugins = [] }) {
  return {
    configFile: false,
    root,
    base: './',
    publicDir: fs.existsSync(path.join(root, 'public')) ? path.join(root, 'public') : false,
    clearScreen: false,
    resolve: {
      alias: { '@shared': sharedDir },
    },
    plugins: [react(), toolboxHtmlPlugin({ csp }), ...extraPlugins],
    server: {
      fs: { allow: [repoRoot] },
    },
    build: {
      outDir,
      emptyOutDir,
      assetsDir: 'assets',
      sourcemap: false,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 4096,
      // Make worker/module assets use ".js" so that *any* static server (including old
      // python -m http.server versions) serves them with a JavaScript MIME type.
      rolldownOptions: {
        output: {
          assetFileNames: (info) => {
            const name = info.names?.[0] ?? info.name ?? 'asset';
            return name.endsWith('.mjs')
              ? 'assets/[name]-[hash].js'
              : 'assets/[name]-[hash][extname]';
          },
        },
      },
    },
  };
}

/** Vite config for one tool in apps/<id>. */
export async function createToolConfig(toolId, { outDir } = {}) {
  const registry = loadRegistry();
  const tool = registry.tools.find((t) => t.id === toolId);
  if (!tool) throw new Error(`Unknown tool "${toolId}". Is it listed in tools.config.json?`);
  const root = path.join(appsDir, toolId);
  let config = baseConfig({
    root,
    outDir: outDir ?? path.join(repoRoot, 'dist', toolId),
    emptyOutDir: true,
    csp: buildCsp(tool.csp),
  });
  // Optional per-tool extension hook: apps/<id>/tool.vite.mjs exporting a config object or
  // a function returning one. Keeps tool-specific build needs inside the tool's folder.
  const extensionFile = path.join(root, 'tool.vite.mjs');
  if (fs.existsSync(extensionFile)) {
    const mod = await import(pathToFileURL(extensionFile).href);
    const extension =
      typeof mod.default === 'function' ? await mod.default({ tool, root }) : mod.default;
    config = mergeConfig(config, extension ?? {});
  }
  return config;
}

/** Vite config for the top-level portal, written to dist/ root. */
export function createPortalConfig({ outDir } = {}) {
  const registry = loadRegistry();
  return baseConfig({
    root: portalDir,
    outDir: outDir ?? path.join(repoRoot, 'dist'),
    emptyOutDir: false,
    csp: buildCsp(),
    extraPlugins: [portalCardsPlugin(registry)],
  });
}
