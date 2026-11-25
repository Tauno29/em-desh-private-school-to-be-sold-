import { application } from '../../functions/routes.mjs';
import {
  BackendError, PostgresStorage, createDatabaseClient, verifySchema,
} from '../../functions/postgres-runtime.mjs';

const db = createDatabaseClient();
const storage = new PostgresStorage();
const handle = application({
  db,
  storage,
  BackendError,
  env: { get: (name) => process.env[name] },
});

let schemaReady;
function ensureSchema() {
  schemaReady ??= verifySchema().catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}

function requestHeaders(event) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined && value !== null) headers.set(name, String(value));
  }
  for (const [name, values] of Object.entries(event.multiValueHeaders ?? {})) {
    if (!headers.has(name) && Array.isArray(values)) headers.set(name, values.join(', '));
  }
  return headers;
}

function bodyBytes(event) {
  if (!event.body) return undefined;
  return event.isBase64Encoded
    ? Uint8Array.from(Buffer.from(event.body, 'base64'))
    : new TextEncoder().encode(event.body);
}

function publicUrl(event) {
  const proto = event.headers?.['x-forwarded-proto'] || 'https';
  const host = event.headers?.host || process.env.URL?.replace(/^https?:\/\//, '') || 'localhost';
  return `${proto}://${host}${event.path || '/'}`;
}

function responseEnvelope(response) {
  return response.arrayBuffer().then((buffer) => ({
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    isBase64Encoded: true,
    body: Buffer.from(buffer).toString('base64'),
  }));
}

async function storageUpload(event, pathname) {
  const objectPath = decodeURIComponent(pathname.replace(/^\/storage\/upload\//, ''));
  const bytes = bodyBytes(event) ?? new Uint8Array();
  if (!objectPath || !bytes.length) return { statusCode: 400, body: 'invalid upload' };
  await storage.put(objectPath, bytes, requestHeaders(event).get('content-type'));
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify({ ok: true }),
  };
}

async function storageView(pathname) {
  const objectPath = decodeURIComponent(pathname.replace(/^\/storage\/view\//, ''));
  const response = await storage.download(objectPath);
  const headers = Object.fromEntries(response.headers.entries());
  headers['cache-control'] = 'private, max-age=3600';
  return responseEnvelope(new Response(response.body, { status: 200, headers }));
}

export async function handler(event) {
  try {
    await ensureSchema();
    const pathname = event.path || '/';
    if (event.httpMethod === 'PUT' && pathname.includes('/storage/upload/')) {
      return await storageUpload(event, pathname.slice(pathname.indexOf('/storage/upload/')));
    }
    if (event.httpMethod === 'GET' && pathname.includes('/storage/view/')) {
      return await storageView(pathname.slice(pathname.indexOf('/storage/view/')));
    }
    const query = event.rawQueryString ? `?${event.rawQueryString}` : '';
    const request = new Request(`${publicUrl(event)}${query}`, {
      method: event.httpMethod,
      headers: requestHeaders(event),
      body: ['GET', 'HEAD'].includes(event.httpMethod) ? undefined : bodyBytes(event),
    });
    return await responseEnvelope(await handle({ request }));
  } catch (error) {
    const status = Number(error?.status) || 500;
    return {
      statusCode: status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      body: JSON.stringify({ error: error?.code || 'request_failed' }),
    };
  }
}
