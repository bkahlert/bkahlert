import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { buildSvg } from './build-svg.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const assets = ['arrakis.jpg', 'moon.jpg', 'CREDITS.txt']
for (const variant of ['webgl', 'webcomponent']) {
  await mkdir(root + variant + '/assets', { recursive: true })
  await Promise.all(assets.map(file => copyFile(root + 'src/assets/' + file, root + variant + '/assets/' + file)))
}
await build({
  absWorkingDir: root, entryPoints: [root + 'src/page.js'], outfile: root + 'webgl/scene.js',
  bundle: true, format: 'esm', loader: { '.css': 'text' }, logLevel: 'error',
})
await build({
  absWorkingDir: root, entryPoints: [root + 'src/component.js'], outfile: root + 'webcomponent/arrakis-orbit-1984.js',
  bundle: true, format: 'esm', loader: { '.css': 'text' }, logLevel: 'error',
})
await buildSvg(root)

const inputsAndOutputs = [
  'package.json', 'package-lock.json', 'index.html', 'webgl/index.html', 'webcomponent/index.html', 'svg/index.html',
  'src/page.js', 'src/component.js', 'src/renderer.js', 'src/scene.css',
  'scripts/build.mjs', 'scripts/build-svg.mjs',
  ...assets.map(file => 'src/assets/' + file),
  ...['webgl', 'webcomponent'].flatMap(variant => assets.map(file => variant + '/assets/' + file)),
  'webgl/scene.js', 'webcomponent/arrakis-orbit-1984.js', 'svg/arrakis-orbit-1984.svg', 'svg/arrakis-orbit-1984-still.svg',
]
const manifest = Object.fromEntries(await Promise.all(inputsAndOutputs.map(async file => {
  const bytes = await readFile(root + file)
  return [file, createHash('sha256').update(bytes).digest('hex')]
})))
await writeFile(root + 'build-manifest.json', JSON.stringify(manifest, null, 2) + '\n')
