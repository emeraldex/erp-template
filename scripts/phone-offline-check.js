/**
 * Drives the phone app in an emulated Pixel 7 against a running facilities
 * demo (SEED_PACK=facilities; API and a production web build running):
 * online load → offline → checklist, note, photo → back online → checks the
 * server received each change once; then a photo + signature step.
 *
 *   ERP_API=http://localhost:4000/api/v1 ERP_WEB=http://localhost:3000 node scripts/phone-offline-check.js
 *
 * Writes screenshots to ./phone-check/. Needs Playwright with Chromium.
 */
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const API = process.env.ERP_API || 'http://localhost:4000/api/v1';
const WEB = process.env.ERP_WEB || 'http://localhost:3000';
const OUT = path.resolve('phone-check');
fs.mkdirSync(OUT, { recursive: true });
const out = (n) => path.join(OUT, `${n}.png`);
// A test photo, made on the fly (a real JPEG so the phone can shrink it).
const PHOTO = path.join(OUT, 'test-photo.jpg');

async function apiAs(playwright, email) {
  const ctx = await playwright.request.newContext({ baseURL: API, extraHTTPHeaders: { 'X-Requested-With': 'erp-web', Origin: WEB } });
  const r = await ctx.post(`${API}/auth/login`, { data: { email, password: 'demo123' } });
  if (!r.ok()) throw new Error(`login ${email}: ${r.status()}`);
  return ctx;
}

(async () => {
  const pw = require('playwright');
  const log = [];
  const check = (ok, what) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };

  // Arrange: a work order assigned to the technician, with a checklist.
  const sup = await apiAs(pw, 'supervisor@company.example');
  const help = await apiAs(pw, 'helpdesk@company.example');
  const job = await (await help.post(`${API}/jobs`, { data: { assetId: 'AST-2026-0005', originUnit: 'Level 7 tenant', category: 'HVAC' } })).json();
  await help.patch(`${API}/jobs/${job.id}/transition`, { data: { to: 'ASSIGNED', fields: { assignee: 'u-technician' } } });
  await sup.patch(`${API}/jobs/${job.id}/checklist`, { data: { add: [{ label: 'Isolate the unit' }, { label: 'Check belt tension' }] } });
  log.push(`job ${job.id}`);

  if (!fs.existsSync(PHOTO)) {
    const maker = await chromium.launch();
    const p = await maker.newPage({ viewport: { width: 1600, height: 1200 } });
    await p.setContent('<body style="margin:0;background:#285a8c"><div style="margin:200px;height:800px;border:30px solid #eee"></div></body>');
    await p.screenshot({ path: PHOTO, type: 'jpeg', quality: 90 });
    await maker.close();
  }
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Sign in on the phone: lands on My work.
  await page.goto(`${WEB}/login`);
  await page.fill('#email', 'technician@company.example');
  await page.fill('#password', 'demo123');
  await page.press('#password', 'Enter');
  await page.waitForURL(/\/m$/, { timeout: 30000 });
  check(true, 'sign-in on a phone opens /m');
  await page.getByText(job.id).first().waitFor({ timeout: 15000 });
  check(true, 'assigned work order listed under Mine');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out('1-my-work') });

  // Installable: manifest + a service worker controlling the page.
  const swReady = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  check(swReady, 'service worker active');
  await page.reload();
  await page.waitForTimeout(1500);
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  check(controlled, 'page controlled by the service worker');

  // Open the job online (caches its pack), then go offline.
  await page.getByText(job.id).first().click();
  await page.waitForURL(/\/m\/job\?id=/);
  await page.getByText('Check belt tension').waitFor();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: out('2-job-online'), fullPage: true });

  await context.setOffline(true);
  await page.reload();
  await page.getByText('Check belt tension').waitFor({ timeout: 15000 });
  check(true, 'job reopens offline from the saved copy');
  check(await page.getByText(/Offline — showing the copy saved/).isVisible(), 'offline notice shown');

  // Field work with no signal.
  await page.getByLabel(/Isolate the unit/).check();
  await page.getByPlaceholder('Add a note…').fill('Belt glazed, replaced from van stock');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await page.getByPlaceholder('What does it show? (optional)').fill('New belt fitted');
  await page.locator('input[type=file][capture]').first().setInputFiles(PHOTO);
  await page.getByText(/3 waiting/).waitFor({ timeout: 15000 });
  check(true, 'three changes waiting while offline');
  await page.waitForTimeout(800);
  await page.screenshot({ path: out('3-job-offline-waiting'), fullPage: true });

  // Steps need a connection.
  check(await page.getByText(/Needs a connection/).first().isVisible(), 'steps say they need a connection');

  // Back online: everything sends.
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByText('All sent').waitFor({ timeout: 30000 });
  check(true, 'all changes sent after reconnecting');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: out('4-job-synced'), fullPage: true });

  const server = await (await sup.get(`${API}/jobs/${job.id}`)).json();
  const files = await (await sup.get(`${API}/attachments/job/${job.id}`)).json();
  check(server.checklist.find((c) => c.label === 'Isolate the unit')?.done === true, 'checklist tick reached the server');
  check(server.audit.some((a) => a.action === 'Note: Belt glazed, replaced from van stock'), 'note reached the server, once');
  check(server.audit.filter((a) => a.action === 'Note: Belt glazed, replaced from van stock').length === 1, 'note not duplicated');
  const photo = files.find((f) => f.kind === 'photo');
  check(!!photo && photo.caption === 'New belt fitted' && photo.contentType === 'image/jpeg', 'photo reached the server with caption');
  check(photo && photo.sizeBytes < 600_000, `photo shrunk on the phone (${photo?.sizeBytes} bytes)`);

  // Proof of work online: start, then complete with a photo and the requester's signature.
  await page.getByRole('button', { name: 'Start work' }).click();
  await page.getByRole('button', { name: 'Complete work' }).waitFor({ timeout: 15000 });
  await page.getByLabel(/Check belt tension/).check();
  await page.getByText('All sent').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Complete work' }).click();
  await page.getByLabel(/Work done \*/).fill('Replaced belt, tensioned, tested');
  await page.getByLabel(/Cause of fault \*/).fill('Belt worn');
  const stepPhoto = page.locator('label:has-text("Photo of the completed work") input[type=file]');
  await stepPhoto.setInputFiles(PHOTO);
  await page.getByText('Replace').first().waitFor({ timeout: 15000 });
  const pad = page.locator('canvas').first();
  await pad.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 20 + i * 20, box.y + box.height / 2 + (i % 2 ? -25 : 25));
  await page.mouse.up();
  await page.getByPlaceholder('Name of the person signing').fill('Siti Aminah');
  await page.getByRole('button', { name: 'Save signature' }).click();
  await page.getByText('Signed by Siti Aminah').waitFor({ timeout: 15000 });
  await page.screenshot({ path: out('5-proof-of-work'), fullPage: true });
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.waitForTimeout(2500);
  const done = await (await sup.get(`${API}/jobs/${job.id}`)).json();
  check(done.status === 'COMPLETED', `work completed with photo and signature (status ${done.status})`);
  const step = done.audit.find((a) => a.action.startsWith('Status → COMPLETED'));
  check(step?.fields?.requesterSignature === 'signed by Siti Aminah', 'audit shows who signed');
  await page.screenshot({ path: out('6-completed'), fullPage: true });

  // QR labels and printed job cards open the phone view.
  await page.goto(`${WEB}/assets?id=AST-2026-0005`);
  await page.waitForURL(/\/m\/asset\?id=AST-2026-0005/, { timeout: 15000 });
  check(true, 'asset QR link opens the phone asset screen');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out('7-asset') });
  await page.goto(`${WEB}/m/more`);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: out('8-more') });

  check(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
  console.log(log.join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
