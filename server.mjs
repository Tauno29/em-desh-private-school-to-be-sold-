import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { application } from './functions/routes.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'school-files';

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the published school website');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TABLES = new Set([
  'sessions', 'login_throttle', 'learners', 'applications', 'gallery_images',
  'behavior_records', 'test_results', 'report_cards',
]);
const ID_TABLES = new Set([
  'learners', 'applications', 'gallery_images', 'behavior_records', 'test_results', 'report_cards',
]);
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const clone = (value) => structuredClone(value);

class SupabaseQuery {
  constructor(table, mode, payload = null) {
    this.table = table;
    this.mode = mode;
    this.payload = payload;
    this.filters = [];
    this.columns = null;
    this.orderBy = null;
    this.limitN = null;
  }
  insert(payload) { return new SupabaseQuery(this.table, 'insert', payload); }
  update(payload) { return new SupabaseQuery(this.table, 'update', payload); }
  delete() { return new SupabaseQuery(this.table, 'delete'); }
  select(columns) { this.columns = columns; return this; }
  eq(column, value) { this.filters.push(['eq', column, value]); return this; }
  neq(column, value) { this.filters.push(['neq', column, value]); return this; }
  order(column, { ascending = true } = {}) { this.orderBy = [column, ascending]; return this; }
  limit(count) { this.limitN = count; return this; }
  async then(resolve, reject) {
    try { return await this.execute().then(resolve, reject); } catch (error) { if (reject) return reject(error); throw error; }
  }
  apply(builder) {
    let query = builder;
    for (const [operator, column, value] of this.filters) query = query[operator](column, value);
    if (this.orderBy) query = query.order(this.orderBy[0], { ascending: this.orderBy[1] });
    if (this.limitN !== null) query = query.limit(Number(this.limitN));
    return query;
  }
  selectedColumns() {
    if (!this.columns) return '*';
    const columns = String(this.columns).split(',').map((part) => part.trim()).filter(Boolean);
    if (!columns.length || columns.some((column) => !IDENTIFIER.test(column))) throw new Error('Unsafe select list');
    return columns.join(',');
  }
  async execute() {
    if (!TABLES.has(this.table)) throw new Error(`Unknown table: ${this.table}`);
    try {
      if (this.mode === 'select') {
        const query = this.apply(supabase.from(this.table).select(this.selectedColumns()));
        const { data, error } = await query;
        return { data: data || [], error };
      }

      if (this.mode === 'insert') {
        const row = { ...(ID_TABLES.has(this.table) ? { id: crypto.randomUUID() } : {}), ...this.payload };
        let query = supabase.from(this.table).insert(row);
        if (this.columns) query = query.select(this.selectedColumns());
        const { data, error } = await query;
        return { data: data || null, error };
      }

      let query;
      if (this.mode === 'delete') query = supabase.from(this.table).delete();
      else query = supabase.from(this.table).update(this.payload ?? {});
      query = this.apply(query);
      if (this.columns) query = query.select(this.selectedColumns());
      const { data, error } = await query;
      return { data: data || null, error };
    } catch (error) {
      const duplicate = error?.code === '23505' || error?.code === '409';
      return { data: null, error: duplicate ? { code: '23505', message: 'duplicate key value violates unique constraint' } : error };
    }
  }
}

function createDatabaseClient() {
  return { from: (table) => new SupabaseQuery(table, 'select') };
}

class SupabaseStorage {
  bucket() { return supabase.storage.from(storageBucket); }
  async createSignedUploadUrl(path) {
    const { data, error } = await this.bucket().createSignedUploadUrl(path);
    if (error || !data?.signedUrl) throw error || new Error('storage_upload_url_unavailable');
    return { signedUrl: data.signedUrl };
  }
  async createSignedUrl(path, expiresIn = 3600) {
    const { data, error } = await this.bucket().createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) throw error || new Error('storage_object_not_found');
    return { signedUrl: data.signedUrl };
  }
  async download(path) {
    const { data, error } = await this.bucket().download(path);
    if (error || !data) throw error || new Error('storage_object_not_found');
    return new Response(await data.arrayBuffer(), { headers: { 'content-type': data.type || 'application/octet-stream' } });
  }
  async remove(paths) {
    if (!paths?.length) return { removed: 0 };
    const { error } = await this.bucket().remove(paths);
    if (error) throw error;
    return { removed: paths.length };
  }
  async put(path, bytes, contentType) {
    const { error } = await this.bucket().upload(path, Buffer.from(bytes), {
      contentType: contentType || 'application/octet-stream',
      upsert: true,
    });
    if (error) throw error;
  }
}

class BackendError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

const db = createDatabaseClient();
const storage = new SupabaseStorage();
const handle = application({
  db,
  storage,
  BackendError,
  env: { get: (name) => process.env[name] },
});

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function headersFor(req) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || ['host', 'connection', 'content-length', 'transfer-encoding'].includes(name)) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  return headers;
}
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function sendResponse(res, response) {
  const headers = Object.fromEntries(response.headers.entries());
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}
async function serveApi(req, res) {
  const body = await readBody(req);
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: headersFor(req),
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });
  try {
    await sendResponse(res, await handle({ request }));
  } catch (error) {
    const status = Number(error?.status) || 500;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: error?.code || 'request_failed' }));
  }
}
async function serveStorageUpload(req, res, pathname) {
  const objectPath = decodeURIComponent(pathname.replace('/storage/upload/', ''));
  const bytes = await readBody(req);
  if (!objectPath || !bytes.length) { res.writeHead(400); res.end('invalid upload'); return; }
  await storage.put(objectPath, bytes, req.headers['content-type']);
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ ok: true }));
}
async function serveStorageView(res, pathname) {
  const objectPath = decodeURIComponent(pathname.replace('/storage/view/', ''));
  const response = await storage.download(objectPath);
  const headers = Object.fromEntries(response.headers.entries());
  headers['cache-control'] = 'private, max-age=3600';
  res.writeHead(200, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}
async function serveStatic(res, pathname) {
  let relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  relative = normalize(relative);
  if (relative.startsWith('..') || relative.includes(`..${sep}`)) { res.writeHead(403); res.end('forbidden'); return; }
  const filePath = join(root, relative);
  if (!filePath.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  try {
    const file = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
    res.end(file);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  try {
    if (pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (pathname.startsWith('/functions/v1/app/')) { await serveApi(req, res); return; }
    if (pathname.startsWith('/storage/upload/') && req.method === 'PUT') { await serveStorageUpload(req, res, pathname); return; }
    if (pathname.startsWith('/storage/view/') && req.method === 'GET') { await serveStorageView(res, pathname); return; }
    if (req.method === 'GET' || req.method === 'HEAD') { await serveStatic(res, pathname); return; }
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end('Method not allowed');
  } catch (error) {
    console.error('request-error', error?.stack || error);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Internal server error');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Em-Desh site listening on 0.0.0.0:${port}`);
});

process.on('SIGTERM', async () => {
  server.close();
});
