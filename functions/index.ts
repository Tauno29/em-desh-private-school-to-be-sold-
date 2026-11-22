import { BackendError, createDatabaseClient, createSiteContext, errorResponse } from './_qoder/backend.mjs';
import { createStorageClient } from './_qoder/storage.mjs';
import { application } from './routes.mjs';

const handle = application({
  db: createDatabaseClient(),
  storage: createStorageClient(),
  BackendError,
  env: { get: (name) => Deno.env.get(name) },
});

Deno.serve(async (request) => {
  let context;
  try {
    context = createSiteContext(request);
    return await handle(context);
  } catch (error) {
    console.log('app-error', error?.code ?? error?.name ?? 'unknown', error?.status ?? '');
    return errorResponse(error, context?.requestId);
  }
});
