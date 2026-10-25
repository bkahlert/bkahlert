import { build } from 'esbuild';
import { copyFile, cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = new URL('../', import.meta.url);
for (const variant of ['webgl', 'webcomponent']) {
  await mkdir(new URL(`${variant}/assets/`, directory), { recursive: true });
  await cp(new URL('src/assets/', directory), new URL(`${variant}/assets/`, directory), { recursive: true });
}
for (const file of ['scene.js', 'scene.css']) {
  await copyFile(new URL(`src/${file}`, directory), new URL(`webgl/${file}`, directory));
}
await build({
  absWorkingDir: fileURLToPath(directory),
  entryPoints: ['src/component.js'],
  outfile: 'webcomponent/arrakis-desert.js',
  bundle: true,
  format: 'esm',
  loader: { '.css': 'text' },
});
