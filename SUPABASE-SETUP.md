# Supabase setup for Em-Desh Private School

The application has been migrated from MySQL to Supabase PostgreSQL and Supabase Storage. The existing Manus-hosted site is unchanged; this setup is for the Vercel version.

## 1. Create the Supabase project

1. Open [supabase.com](https://supabase.com) and create a project.
2. Choose a project name such as `em-desh-private-school`.
3. Set and save a strong database password.
4. Wait until the project is ready.

## 2. Create the database schema

In the Supabase dashboard, open **SQL Editor**, create a new query, paste the complete contents of [`supabase-schema.sql`](./supabase-schema.sql), and run it.

The script creates the application tables and a private `school-files` Storage bucket. It does not create or import learner records.

## 3. Configure Vercel

In **Vercel → Project → Settings → Environment Variables**, add these server-side variables for Preview and Production:

```text
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET=school-files
ADMIN_CODE=YOUR_EXISTING_SIX_DIGIT_STAFF_CODE
```

Add `WEB3FORMS_ACCESS_KEY` only if admissions email forwarding is required.

Get `SUPABASE_URL` and the server-only service-role key from **Supabase → Project Settings → API**. Never put the service-role key in frontend code, commit it, or share it in chat.

After adding variables, redeploy Vercel. Environment changes apply to new deployments.

## 4. Important status

The code and schema are prepared, but a live connection cannot be tested until the Supabase project exists and its protected variables are configured. Existing Manus data is not automatically copied, and the fictional CSV files are not automatically imported.

Before changing the public domain, test the Vercel Preview deployment with:

- staff six-digit login and one-minute lockout;
- learner registration and learner login;
- grade grouping and learner editing;
- admissions applications;
- gallery image upload and deletion;
- report-card upload and download;
- exact-phrase bulk deletion protection.
