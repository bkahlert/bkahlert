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

it('preserves the approved fragment shader exactly', async () => {
  const source = await readFile(path.join(root, 'src/renderer.js'), 'utf8').catch(() => '');
  const fragment = source.split('const fragmentSource = `')[1]?.split('`')[0] || '';
  const digest = createHash('sha256').update(fragment).digest('hex');
  assert.equal(digest, '132374e16eb3b90bd8a5d893133d2c90ee0306b4ab2ee117e029d9dd77593ad6');
});

it('records current sources and generated output hashes', async () => {
  const text = await readFile(path.join(root, 'provenance/build-manifest.json'), 'utf8').catch(() => null);
  assert.notEqual(text, null, 'build manifest exists');
  for (const [file, expected] of Object.entries(JSON.parse(text))) {
    const bytes = await readFile(path.join(root, file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, file + ' is stale; run npm run build');
  }
});

it('preserves credited texture bytes in both live distributions', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'provenance/texture-manifest.json'), 'utf8'));
  for (const [file, entry] of Object.entries(manifest)) {
    const canonical = await readFile(path.join(root, 'src/assets', file));
    assert.equal(createHash('sha256').update(canonical).digest('hex'), entry.output_sha256);
    assert.equal(canonical.length, entry.output_bytes);
    for (const variant of ['webgl', 'webcomponent']) {
      const copied = await readFile(path.join(root, variant, 'assets', file));
      assert.deepEqual(copied, canonical);
    }
  }
  const credits = await readFile(path.join(root, 'src/assets/CREDITS.txt'));
  for (const variant of ['webgl', 'webcomponent']) {
    const copied = await readFile(path.join(root, variant, 'assets/CREDITS.txt'));
    assert.deepEqual(copied, credits);
  }
});

it('records the approved reference image hash', async () => {
  const provenance = JSON.parse(await readFile(path.join(root, 'provenance/references/provenance.json'), 'utf8'));
  const bytes = await readFile(path.join(root, 'provenance/references', provenance.file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.sha256);
});
