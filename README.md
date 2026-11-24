# Em-Desh English Medium Private School

The site is a static frontend backed by a Netlify serverless API using Supabase PostgreSQL. The serverless function is in `netlify/functions/app.mjs`.

## Netlify setup

Create a Netlify site from this repository and use the committed `netlify.toml`. Netlify will run `npm run build`, publish `dist/`, and deploy the `app` function.

Configure these Netlify environment variables for the production deploy:

- `DATABASE_URL`: the Supabase PostgreSQL connection string. The existing MySQL source was copied non-destructively and remains available until the Supabase deployment is fully validated.
- `ADMIN_CODE`: the existing six-digit staff authentication code.
- `PUBLIC_SITE_ORIGIN`: the exact HTTPS Netlify site URL, for example `https://your-site.netlify.app`.
- `SITE_HOST_SUFFIX`: optional owner/domain suffix for an approved site-origin pattern. It is not needed when `PUBLIC_SITE_ORIGIN` is set.
- `DB_CONNECTION_LIMIT`: optional MySQL pool limit; the default is `2`, which is appropriate for serverless cold-start concurrency.

The database user must be allowed to connect from Netlify. The Supabase schema is defined in `supabase/schema.sql`; the Netlify function verifies connectivity at startup and does not run destructive schema changes.

## Preserved workflows

The serverless function keeps the existing API routes and workflows on Supabase: staff authentication and throttling, learner registration and portal access, CSV-compatible learner operations, applications, gallery management, homepage content, welcome-video replacement, learner records, report cards, and deletion workflows.

## Media upload limitation

Netlify Functions have a request-size limit. The current database-backed upload path works for ordinary images, but the existing 25 MB welcome-video and 10 MB report-card limits can exceed Netlify's function request limit. For those larger files, configure a direct-upload object-storage provider and adapt `MysqlStorage` to issue provider-signed upload/view URLs; do not increase the function request body and assume it will accept 25 MB reliably.

## Local verification

```sh
npm install
npm test
npm run build
```

The legacy Node container remains available with `npm start` for the former MySQL runtime. Netlify production uses the PostgreSQL runtime and the Supabase `DATABASE_URL`.
