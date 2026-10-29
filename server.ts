import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePort(): number {
  const portFlagIndex = process.argv.indexOf('--port');
  if (portFlagIndex !== -1 && process.argv[portFlagIndex + 1]) {
    const cliPort = Number(process.argv[portFlagIndex + 1]);
    if (!Number.isNaN(cliPort) && cliPort > 0) {
      return cliPort;
    }
  }
  return Number(process.env.PORT) || 3000;
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = resolvePort();

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', mode: 'free-browser-engine' });
  });

  const distPath = path.resolve(__dirname, 'dist');
  const isDev =
    process.env.npm_lifecycle_event === 'dev' || process.env.NODE_ENV === 'development';
  const isProd = !isDev && fs.existsSync(path.join(distPath, 'index.html'));

  let closeVite: (() => Promise<void>) | null = null;

  if (!isProd) {
    const viteReadyPromise = (async () => {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
          watch: process.env.DISABLE_HMR === 'true' ? null : {},
        },
        appType: 'spa',
      });
      closeVite = () => vite.close();
      return vite;
    })();

    viteReadyPromise.catch((err) => {
      console.error('Failed to initialize Vite dev middleware:', err);
    });

    app.use(async (req, res, next) => {
      try {
        const vite = await viteReadyPromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    app.use(
      express.static(distPath, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
          }
        },
      })
    );
    app.get('*', (req, res) => {
      if (req.path.startsWith('/pdfjs/') || req.path.startsWith('/assets/')) {
        res.status(404).end();
        return;
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Vellum PDF Studio listening on http://0.0.0.0:${PORT}`);
  });

  const shutdown = async () => {
    if (closeVite) {
      await closeVite().catch(() => {});
    }
    httpServer.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer();
