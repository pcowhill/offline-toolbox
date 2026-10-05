// PDF Toolbox build extension: ship pdf.js runtime data (character maps, standard fonts,
// WebAssembly image decoders, ICC profile) next to the app so nothing is fetched from a CDN.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function pdfjsAssets() {
  return {
    name: 'pdf-toolbox:pdfjs-assets',
    // Dev server: serve the files straight from node_modules.
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const relative = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
        const file = path.resolve(pdfjsRoot, relative);
        if (
          !file.startsWith(pdfjsRoot) ||
          !DIRS.includes(relative.split('/')[0]) ||
          !fs.existsSync(file)
        )
          return next();
        res.setHeader(
          'Content-Type',
          file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
        );
        fs.createReadStream(file).pipe(res);
      });
    },
    // Build: emit them as-is (stable names, they are versioned with the package).
    generateBundle() {
      for (const dir of DIRS) {
        for (const file of walk(path.join(pdfjsRoot, dir))) {
          const name = path.relative(pdfjsRoot, file).split(path.sep).join('/');
          // Licence files are kept; the readme-style files of the package are not needed.
          this.emitFile({
            type: 'asset',
            fileName: `pdfjs/${name}`,
            source: fs.readFileSync(file),
          });
        }
      }
    },
  };
}

export default {
  plugins: [pdfjsAssets()],
  build: {
    // pdf.js ships an already-minified legacy build; bigger chunks are expected here.
    chunkSizeWarningLimit: 8192,
  },
};
