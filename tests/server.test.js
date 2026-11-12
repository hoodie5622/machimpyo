import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('local static server serves assets and refuses uploads or unsafe paths', async t => {
  const port = 4189;
  const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, MACHIMPYO_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local server startup timed out.')), 5000);
      child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.stderr.once('data', chunk => { clearTimeout(timer); reject(new Error(chunk.toString())); });
    });
    const base = `http://127.0.0.1:${port}`;
    let response;
    try { response = await fetch(`${base}/package.json`); }
    catch (error) {
      if (error.cause?.code === 'EACCES') {
        t.skip('This sandbox blocks localhost connections; run this check with localhost access.');
        return;
      }
      throw error;
    }
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).name, 'machimpyo');
    const head = await fetch(`${base}/package.json`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const post = await fetch(`${base}/package.json`, { method: 'POST', body: 'no upload' });
    assert.equal(post.status, 405);
    assert.equal((await fetch(`${base}/%ZZ`)).status, 400);
    assert.equal((await fetch(`${base}/..%2fpackage.json`)).status, 403);
    assert.equal((await fetch(`${base}/.git/config`)).status, 403);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit');
      child.kill();
      await exit;
    }
  }
});
