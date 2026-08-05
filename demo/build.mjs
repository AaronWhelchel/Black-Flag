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
  minify: true,   // keeps the single-file demo under desktop-artifact size limits
});
const js = out.outputFiles[0].text;
/** Brand art is inlined as data URLs — the demo has to stay ONE file that
 *  works offline from a Downloads folder, so it can't reference asset paths. */
const dataUrl = (f) => `data:image/png;base64,${readFileSync(join(here, 'assets', f)).toString('base64')}`;
const html = readFileSync(join(here, 'template.html'), 'utf8')
  .replaceAll('__LOGO_128__', () => dataUrl('blackflag-logo-128.png'))
  .replaceAll('__LOGO_192__', () => dataUrl('blackflag-logo-192.png'))
  .replaceAll('__LOGO_256__', () => dataUrl('blackflag-logo-256.png'))
  .replace('/*__BUNDLE__*/', () => js);
const dest = join(here, 'blackflag-demo.html');
writeFileSync(dest, html);
console.log('wrote', dest, `${(html.length / 1024).toFixed(0)} KB`);
