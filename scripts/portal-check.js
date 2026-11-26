/**
 * Drives the request portal end to end in a browser against a fresh
 * facilities demo (SEED_PACK=facilities; API and a production web build
 * running): a requester scans a poster on a phone and sends a request with a
 * photo; the help desk accepts it on the desktop and asks a question; the
 * requester replies; the technician completes the work; the requester rates
 * it; the work order, dashboard, posters and settings show it all.
 *
 *   ERP_API=http://localhost:4000/api/v1 ERP_WEB=http://localhost:3000 node scripts/portal-check.js
 *
 * Writes screenshots to ./portal-check/. Needs Playwright with Chromium.
 */
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const API = process.env.ERP_API || 'http://localhost:4000/api/v1';
const WEB = process.env.ERP_WEB || 'http://localhost:3000';
const OUT = path.resolve('portal-check');
fs.mkdirSync(OUT, { recursive: true });
const PHOTO = path.join(OUT, 'leak.jpg');
const shot = async (page, n) => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true }); };

async function apiAs(pw, email) {
  const ctx = await pw.request.newContext({ baseURL: API, extraHTTPHeaders: { 'X-Requested-With': 'erp-web', Origin: WEB } });
  const r = await ctx.post(`${API}/auth/login`, { data: { email, password: 'demo123' } });
  if (!r.ok()) throw new Error(`login ${email}: ${r.status()}`);
  return ctx;
}

async function signIn(page, email, landing) {
  await page.goto(`${WEB}/login`);
  await page.fill('#email', email);
  await page.fill('#password', 'demo123');
  await page.press('#password', 'Enter');
  await page.waitForURL(landing, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
}

(async () => {
  const pw = require('playwright');
  const log = [];
  const check = (ok, what) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
  const errors = [];
  const watch = (page, who) => {
    page.on('pageerror', (e) => errors.push(`${who}: ${String(e)}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${who}: ${m.text()}`); });
  };

  const help = await apiAs(pw, 'helpdesk@company.example');
  const point = await (await help.post(`${API}/requests/points`, { data: { label: 'Level 7 — pantry', site: 'HQ' } })).json();
  log.push(`poster ${point.code}`);

  const browser = await chromium.launch();
  if (!fs.existsSync(PHOTO)) {
    const p = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await p.setContent('<body style="margin:0;background:#6b8fb3"><div style="margin:150px;height:600px;border:40px solid #2b4a6b;border-radius:40px"></div></body>');
    await p.screenshot({ path: PHOTO, type: 'jpeg', quality: 85 });
    await p.close();
  }

  // ── A requester scans the poster on a phone ──────────────────────────────
  const phone = await browser.newContext({ ...devices['Pixel 7'] });
  const mp = await phone.newPage();
  watch(mp, 'phone');
  await mp.goto(`${WEB}/r?p=${point.code}`);
  await mp.waitForSelector('text=Level 7 — pantry');
  check(true, 'a poster scan opens the form with the place filled in');
  await mp.getByRole('button', { name: 'BM' }).click();
  await mp.waitForSelector('text=Laporkan masalah');
  await shot(mp, '01-form-bm');
  await mp.getByRole('button', { name: 'EN' }).click();
  await mp.fill('textarea', 'The tap under the sink is leaking onto the floor');
  await mp.getByLabel('This is urgent or a safety hazard').check();
  await mp.setInputFiles('input[type=file]', PHOTO);
  await mp.waitForSelector('img[src^="blob:"]');
  await mp.getByLabel('Your name *').fill('Aminah Yusof');
  await mp.getByLabel('Email').fill('aminah@tenant.example');
  await mp.getByLabel('Phone').fill('012-345 6789');
  await shot(mp, '02-form-filled');
  await mp.getByRole('button', { name: 'Send', exact: true }).click();
  await mp.waitForSelector('text=Thank you — we have your request');
  const reqId = (await mp.locator('p.mono.text-2xl').textContent()).trim();
  check(/^REQ-\d{4}-\d{4}$/.test(reqId), `the requester gets a reference (${reqId})`);
  await shot(mp, '03-confirmation');
  await mp.getByRole('link', { name: 'Follow my request' }).click();
  await mp.waitForSelector('text=Received — waiting to be reviewed');
  const trackUrl = mp.url();
  check(trackUrl.includes('/r/track#'), 'the tracking link keeps its token in the fragment');
  await shot(mp, '04-track-received');

  // ── The help desk triages it on the desktop ──────────────────────────────
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const dp = await desk.newPage();
  watch(dp, 'helpdesk');
  await signIn(dp, 'helpdesk@company.example', /\/dashboard/);
  await dp.waitForSelector('text=New requests');
  check(await dp.locator('nav a[href="/requests"] [aria-label$="waiting"]').count() === 1, 'the menu shows how many requests are waiting');
  await dp.click('nav a[href="/requests"]');
  await dp.waitForSelector(`text=${reqId}`);
  await dp.click(`tbody tr:has-text("${reqId}")`);
  await dp.waitForSelector('text=Messages with the requester');
  await dp.waitForFunction(() => [...document.querySelectorAll('img[alt="Photo from the requester"]')].some((i) => i.naturalWidth > 0), null, { timeout: 15000 });
  check(true, 'the help desk sees the requester\'s photo');
  await shot(dp, '05-inbox');
  await dp.getByRole('button', { name: /ACCEPT → NEW/ }).click();
  await dp.locator('label:has-text("Category") select').selectOption('PLUMBING');
  await dp.getByRole('button', { name: 'Accept and register' }).click();
  await dp.waitForSelector('text=Accepted — the work order is registered');
  const jobId = (await dp.locator('a[href^="/jobs/"]').first().textContent()).trim();
  check(/^HD-/.test(jobId), `accepting registers a work order (${jobId})`);
  await dp.fill('textarea[placeholder^="Ask a question"]', 'Is it the cold or the hot tap?');
  await dp.getByRole('button', { name: 'Send', exact: true }).click();
  await dp.waitForSelector('text=Sent — they have been emailed', { timeout: 10000 }).catch(() => dp.waitForSelector('text=Sent — they will see it'));
  await shot(dp, '06-accepted');

  // ── The requester sees progress and replies ──────────────────────────────
  await mp.reload();
  await mp.waitForSelector('text=Is it the cold or the hot tap?');
  check(await mp.locator('[aria-current="step"]:has-text("Accepted")').count() === 1, 'the tracking page shows the request accepted');
  await mp.fill('textarea', 'The cold one, under the left sink');
  await mp.getByRole('button', { name: 'Send message' }).click();
  await mp.waitForSelector('text=The cold one, under the left sink');
  await shot(mp, '07-track-messages');

  // ── The technician completes the work (as the phone app would) ───────────
  const tech = await apiAs(pw, 'technician@company.example');
  await help.patch(`${API}/jobs/${jobId}/transition`, { data: { to: 'ASSIGNED', fields: { assignee: 'u-technician' } } });
  await tech.patch(`${API}/jobs/${jobId}/transition`, { data: { to: 'IN_PROGRESS', fields: {} } });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const up = async (kind, extra) => (await (await tech.post(`${API}/attachments/job/${jobId}`, { multipart: { file: { name: kind === 'signature' ? 'sig.png' : 'after.png', mimeType: 'image/png', buffer: png }, kind, ...extra } })).json()).id;
  const photoAfter = await up('photo', { caption: 'After' });
  const requesterSignature = await up('signature', { signedBy: 'Aminah Yusof' });
  const done = await tech.patch(`${API}/jobs/${jobId}/transition`, { data: { to: 'COMPLETED', fields: { workDone: 'Replaced the tap washer', rootCause: 'Worn washer', photoAfter, requesterSignature } } });
  check(done.ok(), `the technician completes ${jobId}`);

  // ── The requester rates it ───────────────────────────────────────────────
  await mp.reload();
  await mp.waitForSelector('text=How did we do?');
  await mp.getByRole('radio', { name: '4' }).click();
  await mp.fill('textarea[placeholder^="Anything to add"]', 'Quick and tidy, thank you');
  await shot(mp, '08-track-rate');
  await mp.getByRole('button', { name: 'Send rating' }).click();
  await mp.waitForSelector('text=Thank you for your rating');
  check(true, 'the requester rates the finished work');
  await shot(mp, '09-track-rated');

  // ── The work order, dashboard, posters, settings ─────────────────────────
  await dp.goto(`${WEB}/jobs/${jobId}`);
  await dp.waitForLoadState('networkidle');
  await dp.waitForSelector('text=Quick and tidy, thank you');
  check(await dp.locator('text=The cold one, under the left sink').count() > 0, 'the work order shows the requester, the conversation and the rating');
  await shot(dp, '10-work-order');
  await dp.goto(`${WEB}/dashboard`);
  await dp.waitForLoadState('networkidle');
  await dp.waitForSelector('text=Satisfaction · 1 rating, 90 d');
  check(true, 'the dashboard shows satisfaction');
  await shot(dp, '11-dashboard');
  await dp.goto(`${WEB}/requests?tab=POSTERS`);
  await dp.waitForLoadState('networkidle');
  await dp.waitForSelector('text=Level 7 — pantry');
  await dp.getByLabel('Print Level 7 — pantry').check();
  const [dl] = await Promise.all([dp.waitForEvent('download'), dp.getByRole('button', { name: /Print 1 A4 poster/ }).click()]);
  check(/request-poster-.*\.pdf/.test(dl.suggestedFilename()), `prints the poster (${dl.suggestedFilename()})`);
  await shot(dp, '12-posters');

  const admin = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const ap = await admin.newPage();
  watch(ap, 'admin');
  await signIn(ap, 'admin@company.example', /\/dashboard/);
  await ap.goto(`${WEB}/settings`);
  await ap.waitForLoadState('networkidle');
  await ap.waitForSelector('text=Request portal');
  await ap.locator('text=Request portal').first().scrollIntoViewIfNeeded();
  check(await ap.locator('text=/r').count() > 0, 'settings show the portal link');
  await shot(ap, '13-settings');

  // The phone job screen names the requester with a call button.
  const tphone = await browser.newContext({ ...devices['Pixel 7'] });
  const tp = await tphone.newPage();
  watch(tp, 'technician');
  await signIn(tp, 'technician@company.example', /\/m$/);
  await tp.goto(`${WEB}/m/job?id=${jobId}`);
  await tp.waitForSelector('text=Reported by');
  check(await tp.locator('a[href^="tel:"]').count() > 0, 'the phone job screen has a call button for the requester');
  await shot(tp, '14-phone-job');

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  console.log(log.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
