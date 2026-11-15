import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { HOST, parsePort, choosePort, makeDevOverride, healthyResponse } from './dev-network.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const config = JSON.parse(await fs.readFile(path.join(project, 'src-tauri/tauri.conf.json'), 'utf8'));
const preferred = parsePort(process.env.SCRIBE_VOICE_DEV_PORT || new URL(config.build.devUrl).port || '1420');
const port = await choosePort(preferred);
const url = `http://${HOST}:${port}`;
const override = makeDevOverride(config, port);
console.log(port === preferred ? `Scribe Voice development port: ${port}` : `Port ${preferred} is occupied. Scribe Voice will use free port ${port}; no existing process was stopped.`);
if (args.includes('--check')) {
  console.log(JSON.stringify({ port, url, config: override }, null, 2));
  process.exit(0);
}

const token = randomUUID();
let frontend;
let desktop;
let stopping = false;
function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    // Scope the kill strictly to a process tree created by this launcher.
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else child.kill('SIGTERM');
}
function cleanup() {
  if (stopping) return;
  stopping = true;
  terminate(desktop);
  terminate(frontend);
}
process.once('SIGINT', () => { cleanup(); process.exit(130); });
process.once('SIGTERM', () => { cleanup(); process.exit(143); });
process.once('exit', cleanup);
// Only present when launched by a developer harness with a private IPC channel.
process.on('message', message => {
  if (message?.type === 'scribe-stop') { cleanup(); process.exit(0); }
});

try {
  frontend = spawn(process.execPath, [path.join(project, 'scripts/dev-server.mjs')], {
    cwd: project, stdio: 'inherit',
    env: { ...process.env, SCRIBE_VOICE_DEV_PORT: String(port), SCRIBE_VOICE_DEV_TOKEN: token },
  });
  let spawnError;
  frontend.once('error', error => { spawnError = error; });
  const deadline = Date.now() + 120_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (frontend.exitCode !== null || frontend.signalCode !== null) throw new Error(`The frontend server exited before becoming ready (code ${frontend.exitCode}).`);
    try {
      const response = await fetch(`${url}/__scribe_health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok && healthyResponse(await response.json(), token, project)) { ready = true; break; }
    } catch { /* The owned server is still building; do not reuse another server. */ }
    await delay(250);
  }
  if (!ready) throw new Error('Frontend did not become ready within two minutes. Check the build messages above.');
  console.log(`Frontend ready at ${url}. Starting Tauri without a second frontend server.`);
  if (args.includes('--frontend-only')) {
    await new Promise(resolve => frontend.once('exit', resolve));
    process.exitCode = frontend.exitCode || 0;
  } else {
    desktop = spawn(process.execPath, [path.join(project, 'node_modules/@tauri-apps/cli/tauri.js'), 'dev', '--config', JSON.stringify(override), ...args], {
      cwd: project, stdio: 'inherit', env: process.env,
    });
    await new Promise((resolve, reject) => {
      desktop.once('error', reject);
      desktop.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); resolve(); });
    });
  }
} catch (error) {
  console.error(`Scribe Voice development startup failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  cleanup();
}
