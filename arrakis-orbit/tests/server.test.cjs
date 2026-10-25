const { it } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

it('serves all formats and survives malformed paths', async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '../scripts/serve.mjs')], {
    env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const origin = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.stdout.once('data', bytes => resolve(bytes.toString().trim()));
    });
    const pages = ['index.html', 'webgl/index.html', 'webcomponent/index.html', 'svg/index.html'];
    for (const file of [...pages, 'webcomponent/arrakis-orbit.js']) {
      const response = await fetch(`${origin}/${file}`);
      assert.equal(response.status, 200, file);
    }
    for (const file of ['webcomponent.html', 'svg.html']) {
      const removed = await fetch(`${origin}/${file}`);
      assert.equal(removed.status, 404, file);
    }
    const malformed = await fetch(`${origin}/%zz`).catch(() => null);
    assert.equal(malformed?.status, 404);
    const alive = await fetch(`${origin}/`);
    assert.equal(alive.status, 200);
  } finally { server.kill(); }
});
