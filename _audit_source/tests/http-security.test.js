import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

test('HTTP server sets safe headers and rejects untrusted browser origins', async t => {
  const port = await availablePort();
  const base = 'http://127.0.0.1:' + port;
  const serverPath = fileURLToPath(new URL('../server.cjs', import.meta.url));
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      DATABASE_URL: '',
      GEMINI_API_KEY: '',
      ID_SALT: 'security-test-salt-not-for-production'
    },
    stdio: 'ignore'
  });
  t.after(() => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
  }));

  let ready = false;
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(400) });
      if (response.ok) { ready = true; break; }
    } catch { /* Server may still be starting. */ }
    await delay(100);
  }
  assert.equal(ready, true, 'server should start for the smoke test');

  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.deepEqual(Object.keys(healthBody).sort(), ['ok', 'ready']);
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(health.headers.get('x-frame-options'), 'DENY');

  const denied = await fetch(base + '/api/health', { headers: { Origin: 'https://attacker.example' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);

  const sameOrigin = await fetch(base + '/api/health', { headers: { Origin: base } });
  assert.equal(sameOrigin.status, 200);
  assert.equal(sameOrigin.headers.get('access-control-allow-origin'), base);

  const preflight = await fetch(base + '/api/chat', {
    method: 'OPTIONS',
    headers: { Origin: base, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-methods') || '', /POST/);

  const unknown = await fetch(base + '/api/internal-diagnostics');
  assert.equal(unknown.status, 404);
  const errorBody = await unknown.json();
  assert.equal(errorBody.error, 'Rota não encontrada.');

  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.match(page.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
});
