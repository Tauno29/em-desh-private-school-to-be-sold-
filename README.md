# Em-Desh English Medium Private School

The site is a static frontend backed by a Node/MySQL API. It can now run on Netlify using the serverless function in `netlify/functions/app.mjs`.

## Netlify setup

Create a Netlify site from this repository and use the committed `netlify.toml`. Netlify will run `npm run build`, publish `dist/`, and deploy the `app` function.

Configure these Netlify environment variables for the production deploy:

- `DATABASE_URL`: the existing MySQL connection URL. Keep the current MySQL database; no migration is performed.
- `ADMIN_CODE`: the existing six-digit staff authentication code.
- `PUBLIC_SITE_ORIGIN`: the exact HTTPS Netlify site URL, for example `https://your-site.netlify.app`.
- `SITE_HOST_SUFFIX`: optional owner/domain suffix for an approved site-origin pattern. It is not needed when `PUBLIC_SITE_ORIGIN` is set.
- `DB_CONNECTION_LIMIT`: optional MySQL pool limit; the default is `2`, which is appropriate for serverless cold-start concurrency.

The database user must be allowed to connect from Netlify and must have permission to create or alter the application tables on first invocation. If the existing database is already initialized, the function only verifies the schema.

## Preserved workflows

The serverless function keeps the existing API routes and MySQL-backed workflows: staff authentication and throttling, learner registration and portal access, CSV-compatible learner operations, applications, gallery management, homepage content, welcome-video replacement, learner records, report cards, and deletion workflows.

## Media upload limitation

Netlify Functions have a request-size limit. The current database-backed upload path works for ordinary images, but the existing 25 MB welcome-video and 10 MB report-card limits can exceed Netlify's function request limit. For those larger files, configure a direct-upload object-storage provider and adapt `MysqlStorage` to issue provider-signed upload/view URLs; do not increase the function request body and assume it will accept 25 MB reliably.

## Local verification

```sh
npm install
npm test
npm run build
```

The local development server remains available with `npm start` when `DATABASE_URL` is configured.
