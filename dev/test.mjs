// Local route test suite. Run with `node dev/test.mjs`.
import { application } from '../functions/routes.mjs';
import { createFakeDb, createFakeStorage } from './fake-runtime.mjs';

class BackendError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

const db = createFakeDb();
const storage = createFakeStorage();
const handle = application({
  db, storage, BackendError,
  env: { get: (name) => (name === 'ADMIN_PASSWORD' ? 'test-secret-123' : undefined) },
});

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function call(method, path, { body, cookie, origin = 'http://localhost', headers: extra = {}, omitContentType = false } = {}) {
  const headers = { ...extra };
  if (body !== undefined && !omitContentType) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (method !== 'GET') headers.origin = origin;
  const request = new Request(`http://localhost/functions/v1/app${path}`, {
    method, headers,
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  try {
    const response = await handle({ request });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, setCookie: response.headers.get('set-cookie') };
  } catch (error) {
    if (error instanceof BackendError) return { status: error.status, body: { error: error.code } };
    throw error;
  }
}

const cookiePair = (setCookie) => setCookie?.split(';')[0] ?? null;

console.log('--- health and public gallery ---');
let result = await call('GET', '/api/health');
check('health ok', result.status === 200 && result.body.ok === true);

result = await call('GET', '/api/gallery');
check('public gallery starts empty', result.status === 200 && result.body.items.length === 0);

console.log('--- admin auth ---');
result = await call('POST', '/api/admin/login', { body: { password: 'wrong' } });
check('wrong admin password rejected', result.status === 401 && result.body.error === 'invalid_credentials');

result = await call('POST', '/api/admin/login', { body: { password: 'test-secret-123' } });
const adminCookie = cookiePair(result.setCookie);
check('admin login sets session cookie', result.status === 200 && /^__Host-omps_admin=[A-Za-z0-9_-]{43}$/.test(adminCookie ?? ''), JSON.stringify(result.body));

result = await call('GET', '/api/admin/me');
check('admin route without cookie rejected', result.status === 401);

result = await call('GET', '/api/admin/me', { cookie: adminCookie });
check('admin session accepted', result.status === 200 && result.body.role === 'admin');

result = await call('POST', '/api/admin/login', { body: { password: 'test-secret-123' } });
const adminBearer = result.body?.token;
check('login returns bearer token', /^[A-Za-z0-9_-]{43}$/.test(adminBearer ?? ''));

result = await call('GET', '/api/admin/me', { headers: { authorization: `Bearer ${adminBearer}` } });
check('bearer session accepted without cookie', result.status === 200 && result.body.role === 'admin');

result = await call('POST', '/api/admin/logout', { headers: { authorization: `Bearer ${adminBearer}` } });
check('bearer logout accepted', result.status === 200);

result = await call('GET', '/api/admin/me', { headers: { authorization: `Bearer ${adminBearer}` } });
check('bearer logout ends session', result.status === 401);

result = await call('GET', '/api/admin/me', { headers: { authorization: 'Bearer not-a-token' } });
check('malformed bearer token rejected', result.status === 401);

result = await call('POST', '/api/admin/login', { body: { password: 'test-secret-123' } });
const queryToken = result.body?.token;
result = await call('GET', `/api/admin/me?s=${queryToken}`);
check('query session accepted without cookie or header', result.status === 200 && result.body.role === 'admin');

result = await call('GET', '/api/admin/me?s=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
check('unknown query token rejected', result.status === 401);

result = await call('POST', '/api/admin/login', { body: { password: 'test-secret-123' }, origin: 'http://evil.example' });
check('cross-origin admin POST rejected', result.status === 403 && result.body.error === 'origin_forbidden');

result = await call('POST', '/api/admin/login', {
  body: { password: 'test-secret-123' },
  origin: 'https://emdeshprivateschool-wx7u4fclyzp.qoder.website',
});
check('published site origin accepted', result.status === 200, `${result.status} ${JSON.stringify(result.body)}`);

result = await call('POST', '/api/admin/login', {
  body: { password: 'test-secret-123' },
  origin: 'https://oshikuku-mission-school-wx7u4fclyzp.qoder.website',
});
check('renamed-away site origin still accepted under owner suffix', result.status === 200, `${result.status} ${JSON.stringify(result.body)}`);

result = await call('POST', '/api/admin/login', {
  body: { password: 'test-secret-123' },
  origin: 'http://emdeshprivateschool-wx7u4fclyzp.qoder.website',
});
check('plaintext http site origin rejected', result.status === 403 && result.body.error === 'origin_forbidden', `${result.status} ${JSON.stringify(result.body)}`);

result = await call('POST', '/api/admin/login', {
  body: { password: 'test-secret-123' },
  origin: 'https://school.example',
  headers: { 'x-forwarded-host': 'school.example', 'x-forwarded-proto': 'https' },
});
check('gateway forwarded origin accepted', result.status === 200, `${result.status} ${JSON.stringify(result.body)}`);

result = await call('POST', '/api/admin/login', {
  body: { password: 'test-secret-123' },
  origin: 'https://oshikuku-mission-school-wx7u4fclyzp.qoder.website',
  headers: { 'sec-fetch-site': 'cross-site' },
});
check('cross-site fetch metadata rejected', result.status === 403 && result.body.error === 'origin_forbidden');

console.log('--- learner registration ---');
result = await call('POST', '/api/admin/learners', {
  cookie: adminCookie,
  body: {
    firstName: 'Maria', lastName: 'Amutenya', grade: '4', className: 'A',
    guardianName: 'Ndapewa Amutenya', guardianPhone: '+264 81 555 0001',
  },
});
const first = result.body?.learner;
const firstPin = result.body?.pin;
check('learner created with student id', result.status === 201 && /^EDPS-\d{4}-001$/.test(first?.studentId ?? ''), JSON.stringify(result.body));
check('learner class stored', first?.className === 'A', JSON.stringify(first));
check('learner created with 6-digit PIN', /^\d{6}$/.test(firstPin ?? ''));
check('PIN hash is not the PIN', first?.pinHash === undefined && db.tables.learners[0].pin_hash.startsWith('pbkdf2$600000$'));
check('student ID is unique on retry', (() => {
  const ids = new Set(db.tables.learners.map((row) => row.student_id));
  return ids.size === db.tables.learners.length;
})());

result = await call('POST', '/api/admin/learners', {
  cookie: adminCookie,
  body: { firstName: 'Tomas', lastName: 'Shikongo', grade: 'KG', guardianName: '', guardianPhone: '' },
});
const second = result.body?.learner;
check('second learner gets next sequence', result.status === 201 && second?.studentId.endsWith('-002'), second?.studentId);

result = await call('POST', '/api/admin/learners', {
  cookie: adminCookie,
  body: { firstName: '', lastName: 'X', grade: '4' },
});
check('empty first name rejected', result.status === 400 && result.body.error === 'first_name_required');

result = await call('POST', '/api/admin/learners', {
  cookie: adminCookie,
  body: { firstName: 'A', lastName: 'B', grade: '9' },
});
check('invalid grade rejected', result.status === 400 && result.body.error === 'grade_invalid');

result = await call('GET', '/api/admin/learners', { cookie: adminCookie });
check('learner list returns counts', result.status === 200 && result.body.items.length === 2 && result.body.counts.total === 2);

result = await call('POST', '/api/admin/learners', {
  cookie: adminCookie,
  body: { firstName: 'Helvi', lastName: 'Nghipandulwa', grade: 'Grade 6' },
});
check('grade labels normalized', result.status === 201 && result.body.learner.grade === '6', JSON.stringify(result.body));

result = await call('POST', '/api/admin/learners', {
  cookie: adminCookie,
  body: { firstName: 'Kandjii', lastName: 'Uutoni', grade: 'Kindergarten' },
  omitContentType: true,
});
check('JSON body accepted without content-type', result.status === 201 && result.body.learner.grade === 'KG', JSON.stringify(result.body));

result = await call('GET', '/api/admin/learners');
check('learner list requires admin', result.status === 401);

console.log('--- learner portal ---');
result = await call('POST', '/api/portal/login', { body: { studentId: first.studentId, pin: '000000' } });
check('wrong learner PIN rejected', result.status === 401 && result.body.error === 'invalid_credentials');

result = await call('POST', '/api/portal/login', { body: { studentId: 'OMPS-2026-999', pin: firstPin } });
check('unknown student id rejected', result.status === 401);

result = await call('POST', '/api/portal/login', { body: { studentId: first.studentId.toLowerCase(), pin: firstPin } });
const learnerCookie = cookiePair(result.setCookie);
check('learner login works with normalized id', result.status === 200 && learnerCookie?.startsWith('__Host-omps_portal=') && result.body.learner.firstName === 'Maria');

result = await call('GET', '/api/portal/me', { cookie: learnerCookie });
check('learner session reads own record', result.status === 200 && result.body.learner.studentId === first.studentId);

result = await call('POST', '/api/portal/login', { body: { studentId: first.studentId, pin: firstPin } });
const learnerBearer = result.body?.token;
check('learner login returns bearer token', /^[A-Za-z0-9_-]{43}$/.test(learnerBearer ?? ''));

result = await call('GET', '/api/portal/me', { headers: { authorization: `Bearer ${learnerBearer}` } });
check('learner bearer session accepted without cookie', result.status === 200 && result.body.learner.studentId === first.studentId);

result = await call('POST', '/api/portal/logout', { headers: { authorization: `Bearer ${learnerBearer}` } });
result = await call('GET', '/api/portal/me', { headers: { authorization: `Bearer ${learnerBearer}` } });
check('learner bearer logout ends session', result.status === 401);

result = await call('GET', '/api/portal/me', { cookie: adminCookie });
check('admin cookie cannot open portal', result.status === 401);

console.log('--- gallery upload flow ---');
result = await call('POST', '/api/admin/gallery', { cookie: adminCookie, body: { caption: 'X', contentType: 'image/gif', sizeBytes: 100 } });
check('unsupported image type rejected', result.status === 415);

result = await call('POST', '/api/admin/gallery', { cookie: adminCookie, body: { caption: 'Sports day', contentType: 'image/png', sizeBytes: 0 } });
check('zero-size upload rejected', result.status === 400);

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
result = await call('POST', '/api/admin/gallery', { cookie: adminCookie, body: { caption: 'Sports day', contentType: 'image/png', sizeBytes: pngBytes.length } });
const imageId = result.body?.id;
check('upload intent returns signed URL', result.status === 201 && typeof result.body.uploadUrl === 'string' && result.body.uploadUrl.length > 0);

result = await call('POST', `/api/admin/gallery/${imageId}/complete`, { cookie: adminCookie });
check('complete before upload returns 409', result.status === 409 && result.body.error === 'upload_pending');

storage.uploadLast(pngBytes, 'image/png');
result = await call('POST', `/api/admin/gallery/${imageId}/complete`, { cookie: adminCookie });
check('complete marks image ready', result.status === 200 && result.body.item.url.includes('/local-view/') && result.body.item.caption === 'Sports day');

result = await call('GET', '/api/gallery');
check('public gallery shows published image', result.status === 200 && result.body.items.length === 1 && result.body.items[0].url.includes('/local-view/'));

result = await call('GET', '/api/admin/gallery', { cookie: adminCookie });
check('admin gallery lists ready image', result.status === 200 && result.body.items[0].status === 'ready');

console.log('--- admissions applications ---');
result = await call('POST', '/api/apply', {
  body: {
    firstName: 'Ndapewa', lastName: 'Kandjimi', grade: 'KG',
    fatherName: 'Petrus Kandjimi', fatherPhone: '081 111 2222', fatherOccupation: 'Farmer',
    motherName: 'Rachel Kandjimi', motherPhone: '081 333 4444', motherOccupation: 'Nurse',
    guardianName: 'Rachel Kandjimi',
    guardianEmail: 'rachel@example.com', guardianPhone: '0817851924',
    message: 'Please consider our child for next term.', consent: true,
  },
});
check('application accepted', result.status === 201 && result.body.ok === true, JSON.stringify(result.body));

result = await call('GET', '/api/admin/applications');
check('applications require admin', result.status === 401);

result = await call('GET', '/api/admin/applications', { cookie: adminCookie });
const applicationId = result.body?.items?.[0]?.id;
check('admin lists applications', result.status === 200 && result.body.items.length === 1
  && result.body.items[0].status === 'new' && result.body.counts.new === 1, JSON.stringify(result.body));
check('application stores parent details', result.body.items[0].fatherName === 'Petrus Kandjimi'
  && result.body.items[0].fatherPhone === '081 111 2222'
  && result.body.items[0].fatherOccupation === 'Farmer'
  && result.body.items[0].motherName === 'Rachel Kandjimi'
  && result.body.items[0].motherPhone === '081 333 4444'
  && result.body.items[0].motherOccupation === 'Nurse', JSON.stringify(result.body.items[0]));

result = await call('PATCH', `/api/admin/applications/${applicationId}`, { cookie: adminCookie, body: { status: 'contacted' } });
check('application status updated', result.status === 200 && result.body.status === 'contacted');

result = await call('PATCH', `/api/admin/applications/${applicationId}`, { cookie: adminCookie, body: { status: 'bogus' } });
check('invalid application status rejected', result.status === 400);

result = await call('POST', '/api/apply', {
  body: { firstName: '', lastName: 'X', grade: 'KG', guardianName: 'Y', guardianPhone: '081', consent: true },
});
check('application needs learner names', result.status === 400 && result.body.error === 'first_name_required');

result = await call('POST', '/api/apply', {
  body: { firstName: 'A', lastName: 'B', grade: 'KG', guardianName: '', guardianPhone: '081', consent: true },
});
check('application needs guardian', result.status === 400 && result.body.error === 'guardian_required');

result = await call('POST', '/api/apply', {
  body: { firstName: 'A', lastName: 'B', grade: 'KG', guardianName: 'C', consent: true },
});
check('application needs contact detail', result.status === 400 && result.body.error === 'contact_required');

result = await call('POST', '/api/apply', {
  body: { firstName: 'A', lastName: 'B', grade: 'KG', guardianName: 'C', guardianEmail: 'bad', consent: true },
});
check('application validates email', result.status === 400 && result.body.error === 'email_invalid');

result = await call('POST', '/api/apply', {
  body: { firstName: 'A', lastName: 'B', grade: 'KG', guardianName: 'C', guardianPhone: '081' },
});
check('application requires consent', result.status === 400 && result.body.error === 'consent_required');

result = await call('POST', '/api/apply', {
  body: { firstName: 'Spam', lastName: 'Bot', grade: 'KG', guardianName: 'C', guardianPhone: '081', consent: true, website: 'http://spam' },
});
check('honeypot submissions ignored', result.status === 201);
check('honeypot submissions not stored', db.tables.applications.length === 1);

result = await call('DELETE', `/api/admin/applications/${applicationId}`, { cookie: adminCookie });
check('application deleted', result.status === 200);

result = await call('GET', '/api/admin/applications', { cookie: adminCookie });
check('application removed from list', result.status === 200 && result.body.items.length === 0);

console.log('--- PIN changes and session invalidation ---');
result = await call('POST', '/api/portal/change-pin', { cookie: learnerCookie, body: { currentPin: '111111', newPin: '222222' } });
check('wrong current PIN rejected', result.status === 401);

const newPin = '482915';
result = await call('POST', '/api/portal/change-pin', { cookie: learnerCookie, body: { currentPin: firstPin, newPin } });
check('learner changes PIN', result.status === 200);

result = await call('POST', '/api/portal/login', { body: { studentId: first.studentId, pin: firstPin } });
check('old PIN no longer works', result.status === 401);

result = await call('POST', '/api/portal/login', { body: { studentId: first.studentId, pin: newPin } });
const freshCookie = cookiePair(result.setCookie);
check('new PIN works', result.status === 200 && freshCookie);

result = await call('PATCH', '/api/admin/learners/' + second.id, { cookie: adminCookie, body: { resetPin: true } });
const resetPin = result.body?.pin;
check('admin resets PIN', result.status === 200 && /^\d{6}$/.test(resetPin ?? ''), `${result.status} ${JSON.stringify(result.body)}`);

result = await call('POST', '/api/portal/login', { body: { studentId: second.studentId, pin: resetPin } });
const secondCookie = cookiePair(result.setCookie);
check('reset PIN logs in', result.status === 200 && secondCookie);

result = await call('PATCH', `/api/admin/learners/${second.id}`, { cookie: adminCookie, body: { status: 'inactive' } });
check('admin deactivates learner', result.status === 200 && result.body.learner.status === 'inactive');

result = await call('GET', '/api/portal/me', { cookie: secondCookie });
check('deactivated learner session ends', result.status === 401);

result = await call('POST', '/api/portal/login', { body: { studentId: second.studentId, pin: resetPin } });
check('deactivated learner cannot log in', result.status === 403 && result.body.error === 'account_inactive');

result = await call('PATCH', `/api/admin/learners/${second.id}`, { cookie: adminCookie, body: { firstName: 'Thomas', grade: '1', className: 'Blue' } });
check('admin edits learner fields', result.status === 200 && result.body.learner.firstName === 'Thomas'
  && result.body.learner.grade === '1' && result.body.learner.className === 'Blue');

console.log('--- learner records ---');
result = await call('GET', `/api/admin/learners/${first.id}/records`, { cookie: adminCookie });
check('records load for learner', result.status === 200 && result.body.behavior.length === 0
  && result.body.tests.length === 0 && result.body.reportCards.length === 0, JSON.stringify(result.body));

result = await call('GET', `/api/admin/learners/${first.id}/records`);
check('records require admin', result.status === 401);

result = await call('POST', `/api/admin/learners/${first.id}/behavior`, {
  cookie: adminCookie,
  body: { note: 'Helped a classmate during reading time.', recordedOn: '2026-11-18' },
});
const behaviorId = result.body?.item?.id;
check('behavior note saved', result.status === 201 && result.body.item.note.includes('classmate'), JSON.stringify(result.body));

result = await call('POST', `/api/admin/learners/${first.id}/behavior`, { cookie: adminCookie, body: { note: '   ' } });
check('empty behavior note rejected', result.status === 400);

result = await call('POST', `/api/admin/learners/${first.id}/tests`, {
  cookie: adminCookie,
  body: { subject: 'Mathematics', score: 82, term: 'Term 3 2026', recordedOn: '2026-11-19' },
});
const testId = result.body?.item?.id;
check('test result saved', result.status === 201 && result.body.item.score === 82
  && result.body.item.subject === 'Mathematics', JSON.stringify(result.body));

result = await call('POST', `/api/admin/learners/${first.id}/tests`, { cookie: adminCookie, body: { subject: 'English', score: 120 } });
check('invalid test score rejected', result.status === 400);

result = await call('POST', `/api/admin/learners/${first.id}/tests`, { cookie: adminCookie, body: { subject: '', score: 50 } });
check('test result needs a subject', result.status === 400);

result = await call('GET', `/api/admin/learners/${first.id}/records`, { cookie: adminCookie });
check('records list saved entries', result.status === 200
  && result.body.behavior.length === 1 && result.body.tests.length === 1);

result = await call('POST', `/api/admin/learners/${first.id}/report-cards`, {
  cookie: adminCookie, body: { fileName: 'notes.txt', contentType: 'text/plain', sizeBytes: 10 },
});
check('unsupported report type rejected', result.status === 415);

result = await call('POST', `/api/admin/learners/${first.id}/report-cards`, {
  cookie: adminCookie, body: { fileName: 'Term 3 report.pdf', contentType: 'application/pdf', sizeBytes: 0 },
});
check('empty report card rejected', result.status === 400);

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 1, 2, 3]);
result = await call('POST', `/api/admin/learners/${first.id}/report-cards`, {
  cookie: adminCookie,
  body: { fileName: 'Term 3 report.pdf', contentType: 'application/pdf', sizeBytes: pdfBytes.length, term: 'Term 3 2026' },
});
const cardId = result.body?.id;
check('report card intent returns signed URL', result.status === 201 && typeof result.body.uploadUrl === 'string');

result = await call('POST', `/api/admin/report-cards/${cardId}/complete`, { cookie: adminCookie });
check('complete before report upload is pending', result.status === 409);

storage.uploadLast(pdfBytes, 'application/pdf');
result = await call('POST', `/api/admin/report-cards/${cardId}/complete`, { cookie: adminCookie });
check('report card marked ready', result.status === 200 && result.body.item.status === 'ready'
  && result.body.item.url.includes('/local-view/'), JSON.stringify(result.body));

result = await call('GET', '/api/portal/records', { cookie: freshCookie });
check('learner reads own records', result.status === 200 && result.body.behavior.length === 1
  && result.body.tests.length === 1 && result.body.reportCards.length === 1
  && result.body.reportCards[0].url.includes('/local-view/'), JSON.stringify(result.body));

result = await call('GET', '/api/portal/records', { cookie: adminCookie });
check('admin cookie cannot open learner records', result.status === 401);

result = await call('DELETE', `/api/admin/behavior/${behaviorId}`, { cookie: adminCookie });
check('behavior note deleted', result.status === 200);

result = await call('DELETE', `/api/admin/tests/${testId}`, { cookie: adminCookie });
check('test result deleted', result.status === 200);

result = await call('DELETE', `/api/admin/report-cards/${cardId}`, { cookie: adminCookie });
check('report card deleted', result.status === 200);

result = await call('GET', `/api/admin/learners/${first.id}/records`, { cookie: adminCookie });
check('records empty after deletes', result.status === 200 && result.body.behavior.length === 0
  && result.body.tests.length === 0 && result.body.reportCards.length === 0);

console.log('--- learner deletion ---');
result = await call('POST', '/api/admin/learners', {
  cookie: adminCookie,
  body: { firstName: 'Penda', lastName: 'Mvula', grade: '3', guardianName: 'Anna Mvula', guardianPhone: '081 555 0003' },
});
const doomed = result.body?.learner;
const doomedPin = result.body?.pin;
check('deletion fixture learner created', result.status === 201 && !!doomed?.id);

result = await call('POST', `/api/admin/learners/${doomed.id}/behavior`, {
  cookie: adminCookie, body: { note: 'Goes with the record', recordedOn: '2026-11-02' },
});
check('deletion fixture behavior note saved', result.status === 201);

const doomedPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 7, 8]);
result = await call('POST', `/api/admin/learners/${doomed.id}/report-cards`, {
  cookie: adminCookie,
  body: { fileName: 'Term 3 report.pdf', contentType: 'application/pdf', sizeBytes: doomedPdf.length, term: 'Term 3 2026' },
});
const doomedCardId = result.body?.id;
storage.uploadLast(doomedPdf, 'application/pdf');
result = await call('POST', `/api/admin/report-cards/${doomedCardId}/complete`, { cookie: adminCookie });
const doomedObjectPath = db.tables.report_cards.find((row) => row.id === doomedCardId)?.object_path;
check('deletion fixture report card ready', result.status === 200 && !!doomedObjectPath, JSON.stringify(result.body));

result = await call('POST', '/api/portal/login', { body: { studentId: doomed.studentId, pin: doomedPin } });
const doomedCookie = cookiePair(result.setCookie);
check('deletion fixture learner session exists', result.status === 200 && !!doomedCookie);

result = await call('DELETE', `/api/admin/learners/${doomed.id}`);
check('learner delete requires admin', result.status === 401);

result = await call('DELETE', `/api/admin/learners/${doomed.id}`, { cookie: adminCookie });
check('admin deletes learner', result.status === 200, JSON.stringify(result.body));

check('report card storage object removed', !!doomedObjectPath && !storage.objects.has(doomedObjectPath));
check('report card rows cascaded', !db.tables.report_cards.some((row) => row.learner_id === doomed.id));
check('behavior rows cascaded', !db.tables.behavior_records.some((row) => row.learner_id === doomed.id));
check('learner sessions cascaded', !db.tables.sessions.some((row) => row.learner_id === doomed.id));

result = await call('GET', '/api/admin/learners', { cookie: adminCookie });
check('deleted learner absent from list', !result.body.items.some((item) => item.id === doomed.id));

result = await call('GET', `/api/admin/learners/${doomed.id}/records`, { cookie: adminCookie });
check('deleted learner records gone', result.status === 404 && result.body.error === 'not_found');

result = await call('GET', '/api/portal/me', { cookie: doomedCookie });
check('deleted learner session rejected', result.status === 401);

result = await call('POST', '/api/portal/login', { body: { studentId: doomed.studentId, pin: doomedPin } });
check('deleted learner cannot sign in', result.status === 401 && result.body.error === 'invalid_credentials');

result = await call('DELETE', `/api/admin/learners/${doomed.id}`, { cookie: adminCookie });
check('deleting missing learner is 404', result.status === 404 && result.body.error === 'not_found');

console.log('--- gallery deletion ---');
result = await call('DELETE', `/api/admin/gallery/${imageId}`, { cookie: adminCookie });
check('admin deletes image', result.status === 200);

result = await call('GET', '/api/gallery');
check('deleted image no longer public', result.status === 200 && result.body.items.length === 0);

console.log('--- logout and throttling ---');
result = await call('POST', '/api/portal/logout', { cookie: freshCookie });
check('portal logout clears cookie', result.status === 200 && result.setCookie.includes('Max-Age=0'));

result = await call('GET', '/api/portal/me', { cookie: freshCookie });
check('logged-out learner cookie rejected', result.status === 401);

for (let attempt = 1; attempt <= 5; attempt += 1) {
  result = await call('POST', '/api/admin/login', { body: { password: 'bad-guess' } });
  check(`admin failure ${attempt} rejected`, result.status === 401 && result.body.error === 'invalid_credentials');
}
const adminThrottle = db.tables.login_throttle.find((row) => row.throttle_key === 'admin');
const adminLockMs = Date.parse(adminThrottle?.locked_until ?? '') - Date.now();
check('fifth admin failure creates one-minute lock', adminThrottle?.failed_attempts === 5 && adminLockMs > 0 && adminLockMs <= 60_000);
result = await call('POST', '/api/admin/login', { body: { password: 'bad-guess' } });
check('sixth admin attempt is throttled', result.status === 429 && result.body.error === 'too_many_attempts');

for (let attempt = 1; attempt <= 12; attempt += 1) {
  result = await call('POST', '/api/portal/login', { body: { studentId: second.studentId, pin: '000000' } });
}
check('learner failures are throttled per student', result.status === 429 && result.body.error === 'too_many_attempts');

result = await call('POST', '/api/portal/login', { body: { studentId: first.studentId, pin: newPin } });
check('one locked learner does not block others', result.status === 200);
console.log('--- bulk learner deletion ---');
result = await call('DELETE', '/api/admin/learners/bulk-delete', { body: { confirmation: 'delete all learners' } });
check('bulk learner delete requires admin', result.status === 401);
result = await call('DELETE', '/api/admin/learners/bulk-delete', { cookie: adminCookie, body: { confirmation: 'delete all learner' } });
check('bulk learner delete requires exact phrase', result.status === 400 && result.body.error === 'delete_confirmation_required');
const learnerCountBeforeBulkDelete = db.tables.learners.length;
result = await call('DELETE', '/api/admin/learners/bulk-delete', { cookie: adminCookie, body: { confirmation: 'delete all learners' } });
check('bulk learner delete removes all learners', result.status === 200 && result.body.deleted === learnerCountBeforeBulkDelete && db.tables.learners.length === 0);
check('bulk learner delete removes related rows', db.tables.sessions.length === 0 && db.tables.behavior_records.length === 0 && db.tables.test_results.length === 0 && db.tables.report_cards.length === 0);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
