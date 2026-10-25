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

test('keeps only the comparison, README, and package configuration at the root', () => {
  const files = fs.readdirSync(path.join(__dirname, '..'), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name !== '.DS_Store').map(entry => entry.name).sort();
  assert.deepEqual(files, ['.gitignore', 'README.md', 'index.html', 'package-lock.json', 'package.json']);
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
    assert.ok(references.length > 200);
    assert.ok(references.every(reference => reference.startsWith('data:image/') || reference.startsWith('#')));
    assert.match(svg, /Solar System Scope/u);
    if (file.includes('still')) assert.doesNotMatch(svg, /@keyframes|animation:/u);
  }
});

test('build manifest proves artifacts match the checked-in source and texture', () => {
  const { createHash } = require('node:crypto');
  const filename = path.join(__dirname, '../provenance/build-manifest.json');
  assert.ok(fs.existsSync(filename), 'build manifest exists');
  const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
  for (const [file, digest] of Object.entries(manifest.sha256)) {
    const actual = createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex');
    assert.equal(actual, digest, `${file} requires npm run build`);
  }
  const texture = JSON.parse(fs.readFileSync(path.join(__dirname, '../provenance/texture-manifest.json'), 'utf8'));
  const actual = createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', texture.output.file))).digest('hex');
  assert.equal(actual, texture.output.sha256);
  assert.equal(fs.statSync(path.join(__dirname, '..', texture.output.file)).size, texture.output.size_bytes);
});


test('component exposes a reflected Boolean paused property', () => {
  const component = fs.readFileSync(path.join(__dirname, '../src/component.js'), 'utf8');
  assert.match(component, /get paused\(/u);
  assert.match(component, /set paused\(/u);
});

test('approved moons and near particles retain their placement', () => {
  const scene = fs.readFileSync(path.join(__dirname, '../webgl/scene.js'), 'utf8');
  assert.ok(scene.includes('vec2 highCenter=vec2(0.26*aspect,0.20)'));
  assert.ok(scene.includes('vec2 lowCenter=vec2(-0.23*aspect,-0.345)'));
  assert.ok(scene.includes('float verticalScale=mix(0.85,1.5,nearField)'));
});

test('approved shader, terrain and drawing code retain their frozen hashes', () => {
  const { createHash } = require('node:crypto');
  const source = fs.readFileSync(path.join(__dirname, '../src/scene.js'), 'utf8');
  const approved = JSON.parse(fs.readFileSync(path.join(__dirname, '../provenance/approved-artwork.json'), 'utf8'));
  const core = source.slice(source.indexOf('  const resources = [];'), source.indexOf('      exportAssets(width, height) {'));
  const draw = source.slice(source.indexOf('      draw(seconds, particles = true) {'));
  assert.equal(createHash('sha256').update(core).digest('hex'), approved.rendererCoreSha256);
  assert.equal(createHash('sha256').update(draw).digest('hex'), approved.drawSha256);
});

test('freshness checks reject changed sources and missing generated outputs without rebuilding', () => {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'desert-1984-freshness-'));
  const root = path.join(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'provenance/build-manifest.json'), 'utf8'));
  try {
    for (const file of [...Object.keys(manifest.sha256), 'provenance/build-manifest.json', 'provenance/texture-manifest.json', 'tests/package.test.cjs']) {
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
