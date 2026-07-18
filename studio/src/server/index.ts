import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createStudioApp } from './app.js';

const studioRoot = fileURLToPath(new URL('../../', import.meta.url));
const port = Number(process.env.STUDIO_PORT ?? 4173);
const app = createStudioApp();

if (process.env.NODE_ENV === 'production') {
  const dist = resolve(studioRoot, 'dist');
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(resolve(dist, 'index.html'));
  });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: studioRoot,
    appType: 'spa',
    server: { middlewareMode: true },
  });
  app.use(vite.middlewares);
}

app.listen(port, '127.0.0.1', () => {
  console.log(`Video Creation Studio: http://127.0.0.1:${port}`);
});
