import net from 'node:net';

export const HOST = '127.0.0.1';
export function parsePort(value = '1420') {
  if (!/^\d+$/.test(String(value))) throw new Error('SCRIBE_VOICE_DEV_PORT must be a valid TCP port.');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Development port must be between 1 and 65535.');
  return port;
}
export function probePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', error => {
      if (error.code === 'EADDRINUSE') resolve(null);
      else reject(error);
    });
    server.listen(port, HOST, () => {
      const assigned = server.address().port;
      server.close(error => error ? reject(error) : resolve(assigned));
    });
  });
}
export async function choosePort(preferred = 1420) {
  for (let offset = 0; offset < 20 && preferred + offset <= 65535; offset++) {
    const available = await probePort(preferred + offset);
    if (available !== null) return available;
  }
  return probePort(0); // Let Windows choose a free ephemeral port if the range is busy.
}
export function makeDevOverride(config, port) {
  const devUrl = `http://${HOST}:${port}`;
  const oldUrl = new URL(config.build.devUrl);
  const oldHttp = oldUrl.origin;
  const oldWs = oldHttp.replace(/^http/, 'ws');
  let csp = config.app?.security?.csp;
  if (typeof csp === 'string') {
    csp = csp.split(oldHttp).join(devUrl).split(oldWs).join(devUrl.replace(/^http/, 'ws'));
  }
  return {
    // The wrapper owns the frontend process. Tauri must not start a second copy.
    build: { beforeDevCommand: null, devUrl },
    ...(csp ? { app: { security: { csp } } } : {}),
  };
}
export function healthyResponse(body, token, project) {
  return body?.app === 'scribe-voice' && body?.ready === true && body?.token === token && body?.project === project;
}
