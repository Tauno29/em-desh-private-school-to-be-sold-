import { cp, mkdir, rm } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
const files = [
  'index.html', 'gallery.html', 'apply.html', 'portal.html', 'admin.html',
  'styles.css', 'api.js', 'app.js', 'gallery.js', 'apply.js', 'portal.js', 'admin.js',
  'manus-routes.json',
];
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of files) await cp(new URL(`../${file}`, import.meta.url), new URL(file, dist));
await cp(new URL('../assets/', import.meta.url), new URL('assets/', dist), { recursive: true });
console.log(`Built ${files.length} frontend files into dist/`);
