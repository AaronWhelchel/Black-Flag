import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = await build({
  entryPoints: [join(here, 'app.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2020',
  minify: false,
});
const js = out.outputFiles[0].text;
const html = readFileSync(join(here, 'template.html'), 'utf8')
  .replace('/*__BUNDLE__*/', () => js);
const dest = join(here, 'blackflag-demo.html');
writeFileSync(dest, html);
console.log('wrote', dest, `${(html.length / 1024).toFixed(0)} KB`);
