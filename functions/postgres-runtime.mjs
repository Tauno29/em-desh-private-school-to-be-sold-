import pg from 'pg';

const { Pool } = pg;
const TABLES = new Set([
  'sessions', 'login_throttle', 'learners', 'applications', 'gallery_images',
  'behavior_records', 'test_results', 'report_cards', 'site_settings',
]);
const ID_TABLES = new Set([
  'learners', 'applications', 'gallery_images', 'behavior_records', 'test_results', 'report_cards',
]);
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const clone = (value) => structuredClone(value);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for the Supabase-backed school website');
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.DB_CONNECTION_LIMIT ?? 2),
  idleTimeoutMillis: 60000,
  keepAlive: true,
});

function quoteIdentifier(name) {
  if (!IDENTIFIER.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
}

function normalizeValue(value) {
  if (value === undefined) return null;
  return value;
}

class PostgresQuery {
  constructor(table, mode, payload = null) {
    this.table = table;
    this.mode = mode;
    this.payload = payload;
    this.filters = [];
    this.columns = null;
    this.orderBy = null;
    this.limitN = null;
  }
  insert(payload) { return new PostgresQuery(this.table, 'insert', payload); }
  update(payload) { return new PostgresQuery(this.table, 'update', payload); }
  delete() { return new PostgresQuery(this.table, 'delete'); }
  select(columns) { this.columns = columns; return this; }
  eq(column, value) { this.filters.push([column, '=', value]); return this; }
  neq(column, value) { this.filters.push([column, '<>', value]); return this; }
  order(column, { ascending = true } = {}) { this.orderBy = [column, ascending]; return this; }
  limit(count) { this.limitN = count; return this; }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
  selectedColumns() {
    if (!this.columns) return '*';
    const columns = String(this.columns).split(',').map((part) => part.trim()).filter(Boolean);
    if (!columns.length || columns.some((column) => !IDENTIFIER.test(column))) throw new Error('Unsafe select list');
    return columns.map(quoteIdentifier).join(', ');
  }
  whereSql(startIndex = 1) {
    if (!this.filters.length) return { sql: '', values: [] };
    return {
      sql: ` WHERE ${this.filters.map(([column, operator], index) => `${quoteIdentifier(column)} ${operator} $${startIndex + index}`).join(' AND ')}`,
      values: this.filters.map(([, , value]) => normalizeValue(value)),
    };
  }
  async fetchRows() {
    const where = this.whereSql(1);
    let sql = `SELECT ${this.selectedColumns()} FROM ${quoteIdentifier(this.table)}${where.sql}`;
    const values = [...where.values];
    if (this.orderBy) sql += ` ORDER BY ${quoteIdentifier(this.orderBy[0])} ${this.orderBy[1] ? 'ASC' : 'DESC'}`;
    if (this.limitN !== null) { sql += ` LIMIT $${values.length + 1}`; values.push(Number(this.limitN)); }
    const result = await pool.query(sql, values);
    return result.rows;
  }
  async execute() {
    if (!TABLES.has(this.table)) throw new Error(`Unknown table: ${this.table}`);
    try {
      if (this.mode === 'select') return { data: await this.fetchRows(), error: null };
      if (this.mode === 'insert') {
        const row = { ...(ID_TABLES.has(this.table) ? { id: crypto.randomUUID() } : {}), ...this.payload };
        const keys = Object.keys(row).filter((key) => IDENTIFIER.test(key));
        const sql = `INSERT INTO ${quoteIdentifier(this.table)} (${keys.map(quoteIdentifier).join(', ')}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(', ')})`;
        await pool.query(sql, keys.map((key) => normalizeValue(row[key])));
        if (!this.columns) return { data: null, error: null };
        if (row.id) {
          const lookup = new PostgresQuery(this.table, 'select', null).select(this.columns).eq('id', row.id);
          return { data: await lookup.fetchRows(), error: null };
        }
        const selected = String(this.columns).split(',').map((column) => column.trim()).filter(Boolean);
        return { data: [Object.fromEntries(selected.map((column) => [column, clone(row[column])]))], error: null };
      }
      const before = await this.fetchRows();
      if (this.mode === 'delete') {
        const where = this.whereSql(1);
        await pool.query(`DELETE FROM ${quoteIdentifier(this.table)}${where.sql}`, where.values);
        return { data: this.columns ? before : null, error: null };
      }
      const keys = Object.keys(this.payload ?? {}).filter((key) => IDENTIFIER.test(key));
      if (!keys.length) return { data: this.columns ? before : null, error: null };
      const values = keys.map((key) => normalizeValue(this.payload[key]));
      const where = this.whereSql(values.length + 1);
      await pool.query(
        `UPDATE ${quoteIdentifier(this.table)} SET ${keys.map((key, index) => `${quoteIdentifier(key)} = $${index + 1}`).join(', ')}${where.sql}`,
        [...values, ...where.values],
      );
      if (!this.columns) return { data: null, error: null };
      return { data: await this.fetchRows(), error: null };
    } catch (error) {
      const duplicate = error?.code === '23505';
      return { data: null, error: duplicate ? { code: '23505', message: 'duplicate key value violates unique constraint' } : error };
    }
  }
}

export function createDatabaseClient() {
  return { from: (table) => new PostgresQuery(table, 'select') };
}

export class PostgresStorage {
  async createSignedUploadUrl(path) {
    return { signedUrl: `/.netlify/functions/app/storage/upload/${encodeURIComponent(path)}` };
  }
  async createSignedUrl(path) {
    const result = await pool.query('SELECT object_path FROM storage_objects WHERE object_path = $1 LIMIT 1', [path]);
    if (!result.rows.length) throw new Error('storage_object_not_found');
    return { signedUrl: `/.netlify/functions/app/storage/view/${encodeURIComponent(path)}` };
  }
  async download(path) {
    const result = await pool.query('SELECT bytes, content_type FROM storage_objects WHERE object_path = $1 LIMIT 1', [path]);
    if (!result.rows.length) throw new Error('storage_object_not_found');
    return new Response(result.rows[0].bytes, { headers: { 'content-type': result.rows[0].content_type } });
  }
  async remove(paths) {
    if (!paths?.length) return { removed: 0 };
    await pool.query('DELETE FROM storage_objects WHERE object_path = ANY($1::varchar[])', [paths]);
    return { removed: paths.length };
  }
  async put(path, bytes, contentType) {
    await pool.query(
      `INSERT INTO storage_objects (object_path, bytes, content_type, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (object_path) DO UPDATE SET bytes = EXCLUDED.bytes, content_type = EXCLUDED.content_type`,
      [path, Buffer.from(bytes), contentType || 'application/octet-stream', new Date().toISOString()],
    );
  }
}

export async function verifySchema() {
  await pool.query('select 1');
}

export class BackendError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
