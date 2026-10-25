const { it } = require('node:test');
const assert = require('node:assert/strict');
const { readFile, access } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const path = require('node:path');
const root = path.join(__dirname, '..');

it('ships all independently usable formats', async () => {
  for (const file of ['src/renderer.js', 'src/component.js', 'src/page.js', 'scripts/build-svg.mjs', 'webcomponent/arrakis-orbit-1984.js', 'svg/arrakis-orbit-1984.svg', 'svg/arrakis-orbit-1984-still.svg']) {
    const exists = await access(path.join(root, file)).then(() => true, () => false);
    assert.equal(exists, true, file);
  }
});

it('records current sources and generated output hashes', async () => {
  const text = await readFile(path.join(root, 'build-manifest.json'), 'utf8').catch(() => null);
  assert.notEqual(text, null, 'build manifest exists');
  for (const [file, expected] of Object.entries(JSON.parse(text))) {
    const bytes = await readFile(path.join(root, file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, file + ' is stale; run npm run build');
  }
});

it('copies every canonical texture and its credits into each live variant', async () => {
  for (const file of ['arrakis.jpg', 'moon.jpg', 'CREDITS.txt']) {
    const canonical = await readFile(path.join(root, 'src/assets', file));
    for (const variant of ['webgl', 'webcomponent']) {
      const copied = await readFile(path.join(root, variant, 'assets', file));
      assert.deepEqual(copied, canonical);
    }
  }
});
