const { it } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

it('keeps partially covered eclipse rim pixels translucent rather than opaque black', async () => {
  const svg = await readFile(path.join(__dirname, '../svg/arrakis-orbit-1984.svg'), 'utf8');
  const encoded = svg.split('id="arrakis"')[1].split('base64,')[1].split('"')[0];
  const { data, info } = await sharp(Buffer.from(encoded, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const x = Math.floor(info.width / 2);
  const y = Math.floor(info.height * (.5 - .42));
  const index = (y * info.width + x) * 4;
  assert.ok(data[index + 3] > 0 && data[index + 3] < 245, 'fractional edge coverage retains background');
  assert.ok(data[index] > 100, 'edge retains the crimson atmosphere color');
});
