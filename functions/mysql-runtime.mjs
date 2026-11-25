import mysql from 'mysql2/promise';

const TABLES = new Set([
  'sessions', 'login_throttle', 'learners', 'applications', 'gallery_images',
  'behavior_records', 'test_results', 'report_cards', 'site_settings',
]);
const ID_TABLES = new Set([
  'learners', 'applications', 'gallery_images', 'behavior_records', 'test_results', 'report_cards',
]);
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const clone = (value) => structuredClone(value);

function parseDatabaseUrl(value) {
  const url = new URL(value);
  const options = {
    uri: value,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 2),
    maxIdle: Number(process.env.DB_CONNECTION_LIMIT ?? 2),
    idleTimeout: 60000,
    enableKeepAlive: true,
    timezone: 'Z',
  };
  if (url.searchParams.get('ssl') === 'false') delete options.ssl;
  else options.ssl = { rejectUnauthorized: false };
  return options;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for the published school website');
const pool = mysql.createPool(parseDatabaseUrl(databaseUrl));

function quoteIdentifier(name) {
  if (!IDENTIFIER.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `\`${name}\``;
}

function normalizeValue(value) {
  if (value === undefined) return null;
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return Buffer.from(value);
  return value;
}

class MysqlQuery {
  constructor(table, mode, payload = null) {
    this.table = table;
    this.mode = mode;
    this.payload = payload;
    this.filters = [];
    this.columns = null;
    this.orderBy = null;
    this.limitN = null;
  }
  insert(payload) { return new MysqlQuery(this.table, 'insert', payload); }
  update(payload) { return new MysqlQuery(this.table, 'update', payload); }
  delete() { return new MysqlQuery(this.table, 'delete'); }
  select(columns) { this.columns = columns; return this; }
  eq(column, value) { this.filters.push([column, '=', value]); return this; }
  neq(column, value) { this.filters.push([column, '<>', value]); return this; }
  order(column, { ascending = true } = {}) { this.orderBy = [column, ascending]; return this; }
  limit(count) { this.limitN = count; return this; }
  then(resolve, reject) {
    try { return this.execute().then(resolve, reject); } catch (error) { return Promise.reject(error).then(resolve, reject); }
  }
  selectedColumns() {
    if (!this.columns) return '*';
    const columns = String(this.columns).split(',').map((part) => part.trim()).filter(Boolean);
    if (!columns.length || columns.some((column) => !IDENTIFIER.test(column))) throw new Error('Unsafe select list');
    return columns.map(quoteIdentifier).join(', ');
  }
  whereSql() {
    if (!this.filters.length) return { sql: '', values: [] };
    return {
      sql: ` WHERE ${this.filters.map(([column, operator]) => `${quoteIdentifier(column)} ${operator} ?`).join(' AND ')}`,
      values: this.filters.map(([, , value]) => normalizeValue(value)),
    };
  }
  async fetchRows() {
    const where = this.whereSql();
    let sql = `SELECT ${this.selectedColumns()} FROM ${quoteIdentifier(this.table)}${where.sql}`;
    const values = [...where.values];
    if (this.orderBy) sql += ` ORDER BY ${quoteIdentifier(this.orderBy[0])} ${this.orderBy[1] ? 'ASC' : 'DESC'}`;
    if (this.limitN !== null) { sql += ' LIMIT ?'; values.push(Number(this.limitN)); }
    const [rows] = await pool.query(sql, values);
    return rows;
  }
  async execute() {
    if (!TABLES.has(this.table)) throw new Error(`Unknown table: ${this.table}`);
    try {
      if (this.mode === 'select') return { data: await this.fetchRows(), error: null };
      if (this.mode === 'insert') {
        const row = { ...(ID_TABLES.has(this.table) ? { id: crypto.randomUUID() } : {}), ...this.payload };
        const keys = Object.keys(row).filter((key) => IDENTIFIER.test(key));
        const sql = `INSERT INTO ${quoteIdentifier(this.table)} (${keys.map(quoteIdentifier).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
        await pool.query(sql, keys.map((key) => normalizeValue(row[key])));
        if (!this.columns) return { data: null, error: null };
        if (row.id) {
          const lookup = new MysqlQuery(this.table, 'select', null).select(this.columns).eq('id', row.id);
          return { data: await lookup.fetchRows(), error: null };
        }
        const selected = String(this.columns).split(',').map((column) => column.trim()).filter(Boolean);
        return { data: [Object.fromEntries(selected.map((column) => [column, clone(row[column])]))], error: null };
      }
      const before = await this.fetchRows();
      if (this.mode === 'delete') {
        const where = this.whereSql();
        await pool.query(`DELETE FROM ${quoteIdentifier(this.table)}${where.sql}`, where.values);
        return { data: this.columns ? before : null, error: null };
      }
      const keys = Object.keys(this.payload ?? {}).filter((key) => IDENTIFIER.test(key));
      if (!keys.length) return { data: this.columns ? before : null, error: null };
      const where = this.whereSql();
      await pool.query(
        `UPDATE ${quoteIdentifier(this.table)} SET ${keys.map((key) => `${quoteIdentifier(key)} = ?`).join(', ')}${where.sql}`,
        [...keys.map((key) => normalizeValue(this.payload[key])), ...where.values],
      );
      if (!this.columns) return { data: null, error: null };
      return { data: await this.fetchRows(), error: null };
    } catch (error) {
      const duplicate = error?.code === 'ER_DUP_ENTRY';
      return { data: null, error: duplicate ? { code: '23505', message: 'duplicate key value violates unique constraint' } : error };
    }
  }
}

export function createDatabaseClient() {
  return { from: (table) => new MysqlQuery(table, 'select') };
}

export class MysqlStorage {
  async createSignedUploadUrl(path) {
    return { signedUrl: `/.netlify/functions/app/storage/upload/${encodeURIComponent(path)}` };
  }
  async createSignedUrl(path) {
    const [rows] = await pool.query('SELECT object_path FROM storage_objects WHERE object_path = ? LIMIT 1', [path]);
    if (!rows.length) throw new Error('storage_object_not_found');
    return { signedUrl: `/.netlify/functions/app/storage/view/${encodeURIComponent(path)}` };
  }
  async download(path) {
    const [rows] = await pool.query('SELECT bytes, content_type FROM storage_objects WHERE object_path = ? LIMIT 1', [path]);
    if (!rows.length) throw new Error('storage_object_not_found');
    return new Response(rows[0].bytes, { headers: { 'content-type': rows[0].content_type } });
  }
  async remove(paths) {
    if (!paths?.length) return { removed: 0 };
    const placeholders = paths.map(() => '?').join(',');
    await pool.query(`DELETE FROM storage_objects WHERE object_path IN (${placeholders})`, paths);
    return { removed: paths.length };
  }
  async put(path, bytes, contentType) {
    await pool.query(
      `INSERT INTO storage_objects (object_path, bytes, content_type, created_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE bytes = VALUES(bytes), content_type = VALUES(content_type)`,
      [path, Buffer.from(bytes), contentType || 'application/octet-stream', new Date().toISOString()],
    );
  }
}

export async function initSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS learners (
      id CHAR(36) PRIMARY KEY, student_id VARCHAR(32) NOT NULL UNIQUE,
      first_name VARCHAR(80) NOT NULL, last_name VARCHAR(80) NOT NULL,
      grade VARCHAR(8) NOT NULL, class_name VARCHAR(80) NOT NULL DEFAULT '',
      guardian_name VARCHAR(120) NOT NULL, guardian_phone VARCHAR(40) NOT NULL DEFAULT '',
      status VARCHAR(16) NOT NULL DEFAULT 'active', pin_hash TEXT NOT NULL,
      created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL,
      INDEX learners_created_idx (created_at), INDEX learners_status_idx (status)
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash VARCHAR(128) PRIMARY KEY, role VARCHAR(16) NOT NULL,
      learner_id CHAR(36) NULL, expires_at VARCHAR(40) NOT NULL, created_at VARCHAR(40) NOT NULL,
      INDEX sessions_learner_idx (learner_id), INDEX sessions_expiry_idx (expires_at)
    )`,
    `CREATE TABLE IF NOT EXISTS login_throttle (
      throttle_key VARCHAR(255) PRIMARY KEY, failed_attempts INT NOT NULL,
      locked_until VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS applications (
      id CHAR(36) PRIMARY KEY, first_name VARCHAR(80) NOT NULL, last_name VARCHAR(80) NOT NULL,
      grade VARCHAR(8) NOT NULL, father_name VARCHAR(120) NOT NULL DEFAULT '',
      father_phone VARCHAR(40) NOT NULL DEFAULT '', father_occupation VARCHAR(120) NOT NULL DEFAULT '',
      mother_name VARCHAR(120) NOT NULL DEFAULT '', mother_phone VARCHAR(40) NOT NULL DEFAULT '',
      mother_occupation VARCHAR(120) NOT NULL DEFAULT '', guardian_name VARCHAR(120) NOT NULL,
      guardian_email VARCHAR(160) NOT NULL DEFAULT '', guardian_phone VARCHAR(40) NOT NULL DEFAULT '',
      message TEXT NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'new',
      created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL,
      INDEX applications_created_idx (created_at), INDEX applications_status_idx (status)
    )`,
    `CREATE TABLE IF NOT EXISTS gallery_images (
      id CHAR(36) PRIMARY KEY, caption VARCHAR(120) NOT NULL DEFAULT '',
      object_path VARCHAR(255) NOT NULL UNIQUE, content_type VARCHAR(80) NOT NULL,
      size_bytes INT NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'pending',
      homepage_role VARCHAR(16) NOT NULL DEFAULT 'gallery', homepage_order INT NOT NULL DEFAULT 0,
      created_at VARCHAR(40) NOT NULL,
      INDEX gallery_created_idx (created_at), INDEX gallery_status_idx (status)
    )`,
    `CREATE TABLE IF NOT EXISTS site_settings (
      setting_key VARCHAR(80) PRIMARY KEY, setting_value TEXT NOT NULL,
      updated_at VARCHAR(40) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS behavior_records (
      id CHAR(36) PRIMARY KEY, learner_id CHAR(36) NOT NULL, note VARCHAR(500) NOT NULL,
      recorded_on VARCHAR(40) NOT NULL, created_at VARCHAR(40) NOT NULL,
      INDEX behavior_learner_idx (learner_id), INDEX behavior_recorded_idx (recorded_on)
    )`,
    `CREATE TABLE IF NOT EXISTS test_results (
      id CHAR(36) PRIMARY KEY, learner_id CHAR(36) NOT NULL, subject VARCHAR(60) NOT NULL,
      score INT NOT NULL, term VARCHAR(40) NOT NULL DEFAULT '', recorded_on VARCHAR(40) NOT NULL,
      created_at VARCHAR(40) NOT NULL, INDEX tests_learner_idx (learner_id), INDEX tests_recorded_idx (recorded_on)
    )`,
    `CREATE TABLE IF NOT EXISTS report_cards (
      id CHAR(36) PRIMARY KEY, learner_id CHAR(36) NOT NULL, object_path VARCHAR(255) NOT NULL UNIQUE,
      file_name VARCHAR(255) NOT NULL, content_type VARCHAR(80) NOT NULL, size_bytes INT NOT NULL,
      term VARCHAR(40) NOT NULL DEFAULT '', status VARCHAR(16) NOT NULL DEFAULT 'pending', created_at VARCHAR(40) NOT NULL,
      INDEX reports_learner_idx (learner_id), INDEX reports_created_idx (created_at)
    )`,
    `CREATE TABLE IF NOT EXISTS storage_objects (
      object_path VARCHAR(255) PRIMARY KEY, bytes LONGBLOB NOT NULL,
      content_type VARCHAR(80) NOT NULL, created_at VARCHAR(40) NOT NULL
    )`,
  ];
  for (const statement of statements) await pool.query(statement);
  for (const statement of [
    'ALTER TABLE gallery_images ADD COLUMN homepage_role VARCHAR(16) NOT NULL DEFAULT \'gallery\'',
    'ALTER TABLE gallery_images ADD COLUMN homepage_order INT NOT NULL DEFAULT 0',
  ]) {
    try { await pool.query(statement); } catch (error) {
      if (!['ER_DUP_FIELDNAME', 'ER_CANT_DROP_FIELD'].includes(error?.code)) throw error;
    }
  }
}

export class BackendError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
