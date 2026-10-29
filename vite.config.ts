import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig, type Plugin} from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pdfjsDistDir = path.resolve(rootDir, 'node_modules/pdfjs-dist');
const ALLOWED_PDFJS_SUBDIRS = new Set(['wasm', 'iccs', 'cmaps', 'standard_fonts']);

function getPdfjsAssetMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.wasm':
      return 'application/wasm';
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.ttf':
      return 'font/ttf';
    case '.otf':
      return 'font/otf';
    default:
      return 'application/octet-stream';
  }
}

function pdfjsAssetsPlugin(): Plugin {
  const middleware = (
    req: {url?: string},
    res: {
      statusCode: number;
      setHeader: (name: string, value: string) => void;
      end: (chunk?: Buffer | string) => void;
    },
    next: () => void
  ) => {
    const rawUrl = req.url ? req.url.split('?')[0] : '';
    if (!rawUrl.startsWith('/pdfjs/')) {
      next();
      return;
    }

    const relPath = decodeURIComponent(rawUrl.slice('/pdfjs/'.length));
    const segments = relPath.split('/').filter(Boolean);
    if (segments.length < 2 || !ALLOWED_PDFJS_SUBDIRS.has(segments[0])) {
      next();
      return;
    }

    const candidate = path.resolve(pdfjsDistDir, ...segments);
    const allowedSubdirRoot = path.resolve(pdfjsDistDir, segments[0]);
    if (
      !candidate.startsWith(allowedSubdirRoot + path.sep) ||
      !fs.existsSync(candidate) ||
      !fs.statSync(candidate).isFile()
    ) {
      next();
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', getPdfjsAssetMimeType(candidate));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(fs.readFileSync(candidate));
  };

  return {
    name: 'vellum-pdfjs-color-and-graphics-assets',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    closeBundle() {
      const outPdfjsRoot = path.resolve(rootDir, 'dist/pdfjs');
      for (const subdir of ALLOWED_PDFJS_SUBDIRS) {
        const srcDir = path.resolve(pdfjsDistDir, subdir);
        const destDir = path.resolve(outPdfjsRoot, subdir);
        if (fs.existsSync(srcDir)) {
          fs.mkdirSync(destDir, {recursive: true});
          fs.cpSync(srcDir, destDir, {recursive: true});
        }
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [pdfjsAssetsPlugin(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': rootDir,
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
