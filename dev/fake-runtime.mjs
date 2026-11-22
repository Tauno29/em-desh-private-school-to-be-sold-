// Local-only fakes for the Function API. Mirrors the subset of the injected
// database/storage clients used by routes.mjs so flows can run without Deno.
const clone = (value) => structuredClone(value);

const UNIQUE = {
  learners: ['student_id'],
  sessions: ['token_hash'],
  gallery_images: ['object_path'],
  login_throttle: ['throttle_key'],
};

class Query {
  constructor(tables, table, mode, payload = null) {
    this.tables = tables;
    this.table = table;
    this.mode = mode;
    this.payload = payload;
    this.filters = [];
    this.cols = null;
    this.orderBy = null;
    this.limitN = null;
    this.cached = null;
  }

  insert(payload) { return new Query(this.tables, this.table, 'insert', payload); }
  update(payload) { return new Query(this.tables, this.table, 'update', payload); }
  delete() { return new Query(this.tables, this.table, 'delete'); }
  select(cols) { this.cols = cols; return this; }
  eq(column, value) { this.filters.push([column, 'eq', value]); return this; }
  neq(column, value) { this.filters.push([column, 'neq', value]); return this; }
  order(column, { ascending = true } = {}) { this.orderBy = [column, ascending]; return this; }
  limit(count) { this.limitN = count; return this; }
  then(resolve, reject) { return this.execute().then(resolve, reject); }

  project(row) {
    if (!this.cols) return clone(row);
    const output = {};
    for (const column of this.cols.split(',').map((part) => part.trim())) output[column] = clone(row[column]);
    return output;
  }

  matches(row) {
    return this.filters.every(([column, operator, value]) => (
      operator === 'eq' ? row[column] === value : row[column] !== value
    ));
  }

  async execute() {
    if (this.cached) return this.cached;
    const rows = this.tables[this.table] ?? (this.tables[this.table] = []);
    let affected = [];

    if (this.mode === 'insert') {
      const row = { id: crypto.randomUUID(), ...this.payload };
      for (const column of UNIQUE[this.table] ?? []) {
        if (rows.some((existing) => existing[column] === row[column])) {
          this.cached = { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${column}"` } };
          return this.cached;
        }
      }
      rows.push(row);
      affected = [row];
    } else if (this.mode === 'update') {
      affected = rows.filter((row) => this.matches(row));
      for (const row of affected) Object.assign(row, clone(this.payload));
    } else if (this.mode === 'delete') {
      affected = rows.filter((row) => this.matches(row));
      for (const row of affected) rows.splice(rows.indexOf(row), 1);
    } else {
      affected = rows.filter((row) => this.matches(row));
      if (this.orderBy) {
        const [column, ascending] = this.orderBy;
        affected.sort((left, right) => (left[column] > right[column] ? 1 : left[column] < right[column] ? -1 : 0) * (ascending ? 1 : -1));
      }
      if (this.limitN !== null) affected = affected.slice(0, this.limitN);
    }

    this.cached = { data: this.cols ? affected.map((row) => this.project(row)) : null, error: null };
    return this.cached;
  }
}

export function createFakeDb() {
  const tables = {};
  return { tables, from: (table) => new Query(tables, table, 'select') };
}

export function createFakeStorage() {
  const objects = new Map();
  const pendingPaths = [];
  return {
    objects,
    objects_meta: objects,
    pendingPaths,
    async createSignedUploadUrl(path) {
      pendingPaths.push(path);
      return { signedUrl: `/local-upload/${encodeURIComponent(path)}` };
    },
    putObject(path, bytes, contentType) {
      objects.set(path, { bytes: new Uint8Array(bytes), contentType });
    },
    uploadLast(bytes, contentType) {
      const path = pendingPaths[pendingPaths.length - 1];
      if (!path) throw new Error('no pending upload');
      this.putObject(path, bytes, contentType);
      return path;
    },
    async download(path) {
      const object = objects.get(path);
      if (!object) throw new Error('storage_object_not_found');
      return new Response(object.bytes, { headers: { 'content-type': object.contentType } });
    },
    async createSignedUrl(path) {
      if (!objects.has(path)) throw new Error('storage_object_not_found');
      return { signedUrl: `/local-view/${encodeURIComponent(path)}` };
    },
    async remove(paths) {
      for (const path of paths) objects.delete(path);
      return { removed: paths.length };
    },
  };
}
