const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('all three entry pages contain only a background', () => {
  for (const name of ['webgl/index.html', 'webcomponent/index.html', 'svg/index.html']) {
    const html = fs.existsSync(path.join(__dirname, '..', name)) ? fs.readFileSync(path.join(__dirname, '..', name), 'utf8') : '';
    assert.ok(html.startsWith('<!doctype html>'), `${name} exists`);
    assert.doesNotMatch(html, /<nav|<button|<h1|<main|<a\s/u);
  }
});

test('renderer exposes a reusable mount without source rewriting', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../src/scene.js'), 'utf8');
  const generator = fs.readFileSync(path.join(__dirname, '../scripts/build-svg.mjs'), 'utf8');
  assert.match(renderer, /export function mountDesert/u);
  assert.doesNotMatch(generator, /instrumented|\.replace\(/u);
});

test('generated SVG embeds artwork without scripts or external resources', () => {
  for (const file of ['svg/arrakis-desert-1984.svg','svg/arrakis-desert-1984-still.svg']) {
    const svg = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(svg, /<script|<foreignObject|onload=|href="(?:https?:|\/)/u);
    const references = [...svg.matchAll(/href="(?<reference>[^"]+)"/gu)].map(match => match.groups.reference);
    assert.equal(references.filter(reference => reference === '#dust').length, file.includes('still') ? 48 : 96);
    assert.ok(references.every(reference => reference.startsWith('data:image/') || reference.startsWith('#')));
    assert.match(svg, /Solar System Scope/u);
    if (file.includes('still')) assert.doesNotMatch(svg, /@keyframes|animation:/u);
  }
});

test('generated SVG selects square and above-square compositions near 1:1', () => {
  const svg = fs.readFileSync(path.join(__dirname, '../svg/arrakis-desert-1984.svg'), 'utf8');
  const frames = [...svg.matchAll(/<svg class="frame frame-(\d+)"[^>]*viewBox="0 0 ([\d.]+) 1000"/gu)];
  assert.deepEqual(frames.map(([, index, width]) => [Number(index), Number((Number(width) / 1000).toFixed(4))]), [
    [0, 0.5625], [1, 0.75], [2, 1], [3, 1.2], [4, 1.6], [5, 2.1], [6, 3.2],
  ]);
  assert.match(svg, /@media\(min-aspect-ratio:1\/1\)\{\.frame-2\{display:none\}\.frame-3\{display:inline\}\}/u);
  assert.match(svg, /@media\(min-aspect-ratio:6\/5\)\{\.frame-3\{display:none\}\.frame-4\{display:inline\}\}/u);
});

test('build manifest detects stale sources and generated artifacts', () => {
  const { createHash } = require('node:crypto');
  const filename = path.join(__dirname, '../build-manifest.json');
  assert.ok(fs.existsSync(filename), 'build manifest exists');
  const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
  for (const [file, digest] of Object.entries(manifest.sha256)) {
    const actual = createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex');
    assert.equal(actual, digest, `${file} requires npm run build`);
  }
});


test('component exposes a reflected Boolean paused property', () => {
  const component = fs.readFileSync(path.join(__dirname, '../src/component.js'), 'utf8');
  assert.match(component, /get paused\(/u);
  assert.match(component, /set paused\(/u);
});

test('freshness checks reject changed sources and missing generated outputs without rebuilding', () => {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'desert-1984-freshness-'));
  const root = path.join(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build-manifest.json'), 'utf8'));
  try {
    for (const file of [...Object.keys(manifest.sha256), 'build-manifest.json', 'tests/package.test.cjs']) {
      fs.mkdirSync(path.dirname(path.join(temporary, file)), { recursive: true });
      fs.copyFileSync(path.join(root, file), path.join(temporary, file));
    }
    const run = () => spawnSync(process.execPath, ['--test', '--test-name-pattern=build manifest', 'tests/package.test.cjs'], { cwd: temporary, encoding: 'utf8',
      env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'NODE_TEST_CONTEXT')) });
    const current = run();
    assert.equal(current.status, 0, current.stdout);
    fs.appendFileSync(path.join(temporary, 'src/scene.css'), '\n/* stale source */\n');
    const stale = run();
    assert.notEqual(stale.status, 0);
    assert.match(stale.stdout, /src\/scene.css requires npm run build/u);
    fs.copyFileSync(path.join(root, 'src/scene.css'), path.join(temporary, 'src/scene.css'));
    fs.unlinkSync(path.join(temporary, 'svg/arrakis-desert-1984.svg'));
    const missing = run();
    assert.notEqual(missing.status, 0);
    assert.equal(fs.existsSync(path.join(temporary, 'svg/arrakis-desert-1984.svg')), false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('copies the texture and credits into both live distributions', () => {
  for (const file of ['moon.jpg', 'CREDITS.txt']) {
    const canonical = fs.readFileSync(path.join(__dirname, '../src/assets', file));
    for (const variant of ['webgl', 'webcomponent']) {
      const copied = fs.readFileSync(path.join(__dirname, '..', variant, 'assets', file));
      assert.deepEqual(copied, canonical);
    }
  }
});
