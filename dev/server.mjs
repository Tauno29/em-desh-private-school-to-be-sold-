// Local preview server: static files + the Function handler with in-memory data.
// Run with `node dev/server.mjs`; not part of the deployed site.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { application } from '../functions/routes.mjs';
import { createFakeDb, createFakeStorage } from './fake-runtime.mjs';

class BackendError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

const root = fileURLToPath(new URL('..', import.meta.url));
const db = createFakeDb();
const storage = createFakeStorage();

const handle = application({
  db,
  storage,
  BackendError,
  env: { get: (name) => (name === 'ADMIN_PASSWORD' ? 'school-test-123' : undefined) },
});

// Seed a learner and two gallery photos for local visual checks only.
await seed();

async function seed() {
  const { hashSecret } = await import('../functions/security.mjs');
  db.tables.learners = [{
    id: '11111111-1111-4111-8111-111111111111',
    student_id: 'OMPS-2026-001',
    first_name: 'Maria',
    last_name: 'Amutenya',
    grade: '4',
    class_name: 'A',
    guardian_name: 'Ndapewa Amutenya',
    guardian_phone: '+264 81 555 0001',
    status: 'active',
    pin_hash: await hashSecret('482915'),
    created_at: new Date('2026-01-14T08:00:00Z').toISOString(),
    updated_at: new Date('2026-01-14T08:00:00Z').toISOString(),
  }];
  db.tables.learners.push({
    id: '22222222-2222-4222-8222-222222222222',
    student_id: 'OMPS-2026-002',
    first_name: 'Tomas',
    last_name: 'Shikongo',
    grade: 'KG',
    class_name: 'Pre-Primary',
    guardian_name: 'Helena Shikongo',
    guardian_phone: '+264 81 555 0002',
    status: 'active',
    pin_hash: await hashSecret('739201'),
    created_at: new Date('2026-01-15T08:00:00Z').toISOString(),
    updated_at: new Date('2026-01-15T08:00:00Z').toISOString(),
  });

  const photos = [
    ['gallery/local-learning', 'assets/learning.png', 'A learner writing in an exercise book'],
    ['gallery/local-mission', 'assets/mission-church.png', 'The ELCIN church near the school in Okahao'],
  ];
  db.tables.gallery_images = [];
  for (const [index, [objectPath, file, caption]] of photos.entries()) {
    const bytes = await readFile(join(root, file));
    storage.putObject(objectPath, bytes, 'image/png');
    db.tables.gallery_images.push({
      id: `33333333-3333-4333-8333-33333333333${index}`,
      caption,
      object_path: objectPath,
      content_type: 'image/png',
      size_bytes: bytes.length,
      status: 'ready',
      created_at: new Date(Date.now() - index * 86400000).toISOString(),
    });
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function headersFor(req) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (['host', 'connection', 'content-length', 'transfer-encoding'].includes(name)) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  return headers;
}

async function serveApi(req, res) {
  const body = await readBody(req);
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: headersFor(req),
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });
  let response;
  try {
    response = await handle({ request });
  } catch (error) {
    if (error instanceof BackendError) {
      res.writeHead(error.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: error.code }));
      return;
    }
    throw error;
  }
  const headers = Object.fromEntries(response.headers.entries());
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

function serveUpload(req, res, pathname) {
  const objectPath = decodeURIComponent(pathname.replace('/local-upload/', ''));
  return readBody(req).then((bytes) => {
    const contentType = req.headers['content-type'] ?? 'application/octet-stream';
    storage.putObject(objectPath, bytes, contentType);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  }).catch(() => {
    res.writeHead(500);
    res.end('upload failed');
  });
}

function serveView(res, pathname) {
  const objectPath = decodeURIComponent(pathname.replace('/local-view/', ''));
  const object = storage.objects.get(objectPath);
  if (!object) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': object.contentType,
    'content-length': object.bytes.length,
    'cache-control': 'no-store',
  });
  res.end(Buffer.from(object.bytes));
}

async function serveStatic(res, pathname) {
  let relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  relative = normalize(relative);
  if (relative.startsWith('..') || relative.includes(`..${sep}`)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  const filePath = join(root, relative);
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(file);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  try {
    if (pathname.startsWith('/functions/v1/app/api/')) {
      await serveApi(req, res);
      return;
    }
    if (req.method === 'PUT' && pathname.startsWith('/local-upload/')) {
      await serveUpload(req, res, pathname);
      return;
    }
    if (req.method === 'GET' && pathname.startsWith('/local-view/')) {
      serveView(res, pathname);
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(res, pathname);
      return;
    }
    res.writeHead(405);
    res.end('Method not allowed');
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Preview server error');
  }
});

const port = Number(process.env.PORT ?? 4173);
server.listen(port, '0.0.0.0', () => {
  console.log(`Preview: http://localhost:${port}/`);
  console.log('Admin password (local only): school-test-123');
  console.log('Seeded learner: OMPS-2026-001 / PIN 482915');
});
