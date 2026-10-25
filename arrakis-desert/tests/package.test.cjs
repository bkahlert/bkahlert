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
  for (const file of ['svg/arrakis.svg','svg/arrakis-still.svg']) {
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
