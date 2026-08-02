/**
 * Builds the Captain's PWA: the planning surface (shared with demo/) plus
 * web manifest and a cache-first service worker — installable, offline-capable.
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const dist = join(here, 'dist');
mkdirSync(dist, { recursive: true });

const out = await build({
  entryPoints: [join(root, 'demo', 'app.ts')],
  bundle: true, write: false, format: 'iife', target: 'es2020', minify: true,
});
const js = out.outputFiles[0].text;

const pwa = `
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#10141a">
<script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');</script>
</head>`;

const html = readFileSync(join(root, 'demo', 'template.html'), 'utf8')
  .replace('</head>', pwa)
  .replace('/*__BUNDLE__*/', () => js);

writeFileSync(join(dist, 'index.html'), html);
copyFileSync(join(here, 'public', 'manifest.webmanifest'), join(dist, 'manifest.webmanifest'));
copyFileSync(join(here, 'public', 'sw.js'), join(dist, 'sw.js'));
console.log('built apps/web/dist — serve with: npx serve apps/web/dist');
