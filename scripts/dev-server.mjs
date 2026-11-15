// Vite/Rollup watch avoids esbuild ancestor scans in restricted Windows workspaces.
import { build } from 'vite';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { HOST, parsePort, probePort } from './dev-network.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(project);
const port = parsePort(process.env.SCRIBE_VOICE_DEV_PORT || '1420');
const origin = `http://${HOST}:${port}`;
if (await probePort(port) === null) {
  console.error(`Port ${port} is already in use. Nothing was stopped. Use npm run desktop:dev to select a free port automatically, or stop your previous preview with Ctrl+C.`);
  process.exit(1);
}
const checked = spawnSync(process.execPath, [path.join(project, 'node_modules/typescript/bin/tsc'), '--noEmit'], { stdio: 'inherit' });
if (checked.status !== 0) process.exit(checked.status || 1);
const clients = new Set();
let watcher;
let server;
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const client of clients) client.end();
  if (watcher) await watcher.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  process.exit(code);
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
try {
  console.log('Building initial Scribe Voice development UI…');
  await build({ configLoader: 'runner', build: { minify: false, sourcemap: true } });
  watcher = await build({ configLoader: 'runner', build: { watch: {}, minify: false, sourcemap: true } });
  const dist = path.join(project, 'dist');
  const reload = `<script>const s=new EventSource('/__scribe_reload');s.onmessage=()=>location.reload();</script>`;
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.map': 'application/json', '.ico': 'image/x-icon' };
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    if (url.pathname === '/__scribe_health') {
      // Only report ready when the entry file exists (the initial watch build can replace it).
      const ready = await fs.access(path.join(dist, 'index.html')).then(() => true, () => false);
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ app: 'scribe-voice', project, ready, token: process.env.SCRIBE_VOICE_DEV_TOKEN || null, port }));
      return;
    }
    if (url.pathname === '/__scribe_reload') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    try {
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const filename = path.resolve(dist, '.' + relative);
      if (filename !== dist && !filename.startsWith(dist + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
      let body = await fs.readFile(filename);
      const ext = path.extname(filename);
      if (ext === '.html') body = Buffer.from(body.toString('utf8').replace('</body>', reload + '</body>'));
      res.writeHead(200, { 'content-type': mime[ext] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(body);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  watcher.on('event', event => {
    if (event.code === 'END') for (const client of clients) client.write('data: reload\n\n');
    if (event.code === 'ERROR') console.error(event.error.message);
  });
  server.once('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} became occupied during the build. Retry npm run desktop:dev; it will choose another free port.` : error.message);
    void stop(1);
  });
  server.listen(port, HOST, () => console.log(`Scribe Voice dev UI ready: ${origin} (full-page live reload)`));
} catch (error) {
  console.error(error.message);
  await stop(1);
}
