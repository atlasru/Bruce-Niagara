import { build } from 'esbuild';
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, validateImage } from '../src/core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const directoryFlag = process.argv.indexOf('--firmware-dir');
const firmwareDir = directoryFlag >= 0 ? resolve(process.argv[directoryFlag + 1]) : null;
const manifest = validateManifest(JSON.parse(await readFile(resolve(root, 'public/firmware.json'), 'utf8')));
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(root, 'public'), dist, { recursive: true });
await cp(resolve(root, '../docs/niagara/home.png'), resolve(dist, 'preview.png'));
await build({ entryPoints: [resolve(root, 'src/app.mjs')], outfile: resolve(dist, 'app.js'),
  bundle: true, minify: true, format: 'esm', target: 'es2022', legalComments: 'eof' });
for (const image of Object.values(manifest.images)) {
  if (!/^[a-zA-Z0-9_.-]+\.bin$/.test(image.asset)) throw new Error('Invalid asset name');
  let bytes;
  if (firmwareDir) bytes = new Uint8Array(await readFile(resolve(firmwareDir, image.asset)));
  else {
    const url = `https://github.com/atlasru/Bruce-Niagara/releases/download/${manifest.tag}/${image.asset}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Firmware download: ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  await validateImage(image, bytes);
  if (createHash('md5').update(bytes).digest('hex') !== image.md5) throw new Error('MD5 mismatch');
  const destination = resolve(dist, image.path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  console.log(`Verified ${image.asset}: ${bytes.length} bytes, SHA-256 ${image.sha256}`);
}
await mkdir(resolve(dist, 'licenses'), { recursive: true });
const licenses = [['esptool-js', 'LICENSE'], ['pako', 'LICENSE'], ['atob-lite', 'LICENSE.md']];
for (const [name, filename] of licenses) {
  await cp(resolve(root, `node_modules/${name}/${filename}`), resolve(dist, `licenses/${name}.txt`));
}
await cp(resolve(root, '../LICENSE'), resolve(dist, 'licenses/Bruce-Niagara.txt'));
await writeFile(resolve(dist, 'licenses/index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Licenses · Bruce Niagara</title><h1>Licenses</h1><ul><li><a href="Bruce-Niagara.txt">Bruce Niagara / Bruce — AGPL-3.0</a></li>${licenses.map(([name]) => `<li><a href="${name}.txt">${name}</a></li>`).join('')}</ul><p><a href="https://github.com/atlasru/Bruce-Niagara">Source code</a></p></html>`);
await writeFile(resolve(dist, '.nojekyll'), '');
console.log(`Built ${dist}`);
