const { it } = require('node:test')
const assert = require('node:assert/strict')
const { readFile, readdir } = require('node:fs/promises')
const { createHash } = require('node:crypto')
const path = require('node:path')
const { build } = require('esbuild')
const root = path.join(__dirname, '..')

it('keeps only entrypoints and package metadata loose at the root', async () => {
  const entries = await readdir(root, { withFileTypes: true });
  const files = entries.filter(entry => entry.isFile()).map(entry => entry.name).sort();
  assert.deepEqual(files, ['.gitignore', 'README.md', 'index.html', 'package-lock.json', 'package.json']);
});

it('copies every canonical texture and its credits into each live variant', async () => {
  for (const variant of ['webgl', 'webcomponent']) {
    for (const name of ['arrakis.jpg', 'caladan-clouds.jpg', 'moon.jpg', 'CREDITS.txt']) {
      const copied = await readFile(path.join(root, variant, 'assets', name)).catch(() => null);
      assert.notEqual(copied, null, `${variant}/assets/${name} exists`);
      const source = await readFile(path.join(root, 'src/assets', name));
      assert.equal(copied.equals(source), true, `${variant}/${name} matches its canonical source`);
    }
  }
});

it('preserves all credited texture and reference hashes', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'provenance/texture-manifest.json'), 'utf8'))
  for (const [file, entry] of Object.entries(manifest)) {
    const bytes = await readFile(path.join(root, 'src/assets', file))
    const digest = createHash('sha256').update(bytes).digest('hex')
    assert.equal(digest, entry.output_sha256, file)
    assert.equal(bytes.length, entry.output_bytes, file)
  }
  const references = JSON.parse(await readFile(path.join(root, 'provenance/references/provenance.json'), 'utf8'))
  for (const reference of references) {
    const bytes = await readFile(path.join(root, 'provenance/references', reference.file))
    const digest = createHash('sha256').update(bytes).digest('hex')
    assert.equal(digest, reference.sha256, reference.file)
  }
})

it('matches generated provenance against every recorded source and output', async () => {
  const manifestFile = path.join(root, 'provenance/build-manifest.json')
  const present = await readFile(manifestFile, 'utf8').catch(() => null)
  assert.notEqual(present, null, 'build provenance exists')
  const manifest = JSON.parse(present)
  for (const [file, expected] of Object.entries(manifest)) {
    const bytes = await readFile(path.join(root, file))
    const actual = createHash('sha256').update(bytes).digest('hex')
    assert.equal(actual, expected, `${file} changed since build; regenerate artifacts`)
  }
})

it('ships bundles regenerated from the current shared renderer', async () => {
  for (const [source, output, format] of [['page', 'webgl/scene', 'iife'], ['component', 'webcomponent/arrakis-orbit', 'esm']]) {
    const generated = await build({
      absWorkingDir: root,
      entryPoints: [path.join(root, `src/${source}.js`)],
      bundle: true,
      format,
      loader: { '.css': 'text' },
      write: false,
      logLevel: 'error',
    })
    const existing = await readFile(path.join(root, `${output}.js`), 'utf8')
    assert.equal(existing, generated.outputFiles[0].text, output)
  }
})

it('keeps runtime entrypoints free of repository-external dependencies', async () => {
  for (const directory of ['src', 'webgl', 'webcomponent']) {
    for (const file of await readdir(path.join(root, directory))) {
      if (!file.endsWith('.js')) continue
      const text = await readFile(path.join(root, directory, file), 'utf8')
      assert.equal(text.includes('/Users/'), false, file)
      assert.equal(text.includes('choam.de/'), false, file)
      assert.equal(text.includes('arrakis-desert/'), false, file)
    }
  }
})
