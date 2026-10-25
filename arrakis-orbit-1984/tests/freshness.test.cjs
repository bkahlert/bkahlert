const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const process = require('node:process');

it('rejects changed sources and missing outputs without rebuilding', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit1984-freshness-'));
  try {
    const root = path.join(__dirname, '..');
    await fs.cp(root, directory, { recursive: true, filter: filename => !['node_modules', 'test-results'].includes(path.basename(filename)) });
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    const renderer = path.join(directory, 'src/renderer.js');
    const original = await fs.readFile(renderer);
    await fs.appendFile(renderer, '\n');
    const stale = spawnSync(process.execPath, ['--test', 'tests/build.test.cjs'], { cwd: directory, encoding: 'utf8', env: environment });
    assert.notEqual(stale.status, 0, stale.stdout + stale.stderr);
    assert.match(stale.stdout, /src\/renderer.js is stale/);
    await fs.writeFile(renderer, original);
    await fs.unlink(path.join(directory, 'svg/arrakis-orbit-1984.svg'));
    const missing = spawnSync(process.execPath, ['--test', 'tests/build.test.cjs'], { cwd: directory, encoding: 'utf8', env: environment });
    assert.notEqual(missing.status, 0);
    const restored = await fs.access(path.join(directory, 'svg/arrakis-orbit-1984.svg')).then(() => true, () => false);
    assert.equal(restored, false);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
