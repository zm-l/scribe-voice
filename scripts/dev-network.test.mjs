import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { HOST, parsePort, probePort, choosePort, makeDevOverride, healthyResponse } from './dev-network.mjs';

test('port parsing rejects invalid values', () => {
  assert.equal(parsePort('1420'), 1420);
  for (const value of ['0', '-1', '65536', 'abc', '1420x', '']) assert.throws(() => parsePort(value));
});
test('occupied ports are skipped without stopping their listener', async t => {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, HOST, resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const occupied = listener.address().port;
  assert.equal(await probePort(occupied), null);
  const selected = await choosePort(occupied);
  assert.notEqual(selected, occupied);
  assert.equal(await probePort(selected), selected);
  assert.equal(listener.listening, true);
});
test('Tauri URL and CSP use the chosen port, with no second beforeDevCommand', () => {
  const original = { build: { devUrl: 'http://127.0.0.1:1420', beforeDevCommand: 'npm run dev' }, app: { security: { csp: "connect-src ipc: http://ipc.localhost http://127.0.0.1:1420 ws://127.0.0.1:1420" } } };
  const override = makeDevOverride(original, 1421);
  assert.equal(override.build.devUrl, 'http://127.0.0.1:1421');
  assert.equal(override.build.beforeDevCommand, null);
  assert.match(override.app.security.csp, /http:\/\/127\.0\.0\.1:1421/);
  assert.match(override.app.security.csp, /ws:\/\/127\.0\.0\.1:1421/);
  assert.doesNotMatch(override.app.security.csp, /:1420/);
  assert.equal(original.build.beforeDevCommand, 'npm run dev');
  assert.equal(original.build.devUrl, 'http://127.0.0.1:1420');
});
test('readiness requires the owned server token, project, app and ready flag', () => {
  const valid = { app: 'scribe-voice', ready: true, token: 'owned-token', project: 'test-project' };
  assert.equal(healthyResponse(valid, 'owned-token', 'test-project'), true);
  for (const altered of [{ ...valid, ready: false }, { ...valid, token: 'another-token' }, { ...valid, project: 'another-project' }, { ...valid, app: 'another-app' }, null]) {
    assert.equal(healthyResponse(altered, 'owned-token', 'test-project'), false);
  }
});
test('configurations without a CSP still get the correct dev URL', () => {
  const override = makeDevOverride({ build: { devUrl: 'http://127.0.0.1:1420' } }, 1900);
  assert.deepEqual(override, { build: { beforeDevCommand: null, devUrl: 'http://127.0.0.1:1900' } });
});
