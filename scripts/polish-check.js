/**
 * Drives Phase 8 end to end in a browser against a fresh facilities demo
 * (SEED_PACK=facilities; API and a production web build running): the admin
 * gives the organisation a logo and colour and sees it in dark and light; a
 * manager sets labour rates; the help desk registers a breakdown with the
 * asset out of action; a technician logs time on a phone with no signal and
 * it reaches the server once reconnected; the work order shows its cost; the
 * asset shows its downtime and reliability; the dashboard counts it; finance
 * raises an invoice whose PDF carries the logo and exports the period to
 * accounting.
 *
 *   ERP_API=http://localhost:4000/api/v1 ERP_WEB=http://localhost:3000 node scripts/polish-check.js
 *
 * Writes screenshots to ./polish-check/. Needs Playwright with Chromium.
 */
const fs = require('fs');
const path = require('path');
const { chromium, devices, request: pwRequest } = require('playwright');
const API = process.env.ERP_API || 'http://localhost:4000/api/v1';
const WEB = process.env.ERP_WEB || 'http://localhost:3000';
const OUT = path.resolve('polish-check');
fs.mkdirSync(OUT, { recursive: true });
const LOGO = path.join(OUT, 'logo.png');
const shot = async (page, n) => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true }); };
const today = new Date().toISOString().slice(0, 10);

async function apiAs(email) {
  const ctx = await pwRequest.newContext({ baseURL: API, extraHTTPHeaders: { 'X-Requested-With': 'erp-web', Origin: WEB } });
  const r = await ctx.post(`${API}/auth/login`, { data: { email, password: 'demo123' } });
  if (!r.ok()) throw new Error(`login ${email}: ${r.status()}`);
  return ctx;
}
async function ok(res, what) {
  if (!res.ok()) throw new Error(`${what}: ${res.status()} ${await res.text()}`);
  return res.status() === 204 ? null : res.json();
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
  const log = [];
  const check = (pass, what) => { log.push(`${pass ? 'PASS' : 'FAIL'} ${what}`); if (!pass) process.exitCode = 1; };
  const errors = [];
  const watch = (page, who) => {
    page.on('pageerror', (e) => errors.push(`${who}: ${String(e)}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(`${who}: ${m.text()}`); });
  };
  const browser = await chromium.launch();

  // A logo to upload: drawn in the browser and saved as PNG.
  {
    const p = await browser.newPage({ viewport: { width: 480, height: 160 } });
    await p.setContent(`<body style="margin:0;background:transparent"><div style="width:480px;height:160px;display:flex;align-items:center;gap:20px;font:700 56px Arial;color:#0b6e4f">
      <div style="width:120px;height:120px;border-radius:24px;background:#0b6e4f;margin-left:20px"></div>GreenFM</div></body>`);
    await p.screenshot({ path: LOGO, omitBackground: true });
    await p.close();
  }

  // ── The admin brands the organisation ─────────────────────────────────────
  const admin = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const ap = await admin.newPage();
  watch(ap, 'admin');
  await signIn(ap, 'admin@company.example', /\/dashboard/);
  await ap.goto(`${WEB}/settings`);
  await ap.getByRole('button', { name: 'Upload logo' }).waitFor();
  await ap.locator('input[type=file][accept="image/png,image/jpeg"]').setInputFiles(LOGO);
  await ap.getByRole('button', { name: 'Replace' }).waitFor({ timeout: 15000 });
  check(true, 'logo uploaded from settings');
  await ap.getByLabel('Use our own colour').check();
  await ap.getByLabel('Brand colour code').fill('#f5e663');
  check(await ap.getByText(/hard to read/).isVisible(), 'a pale colour is refused for poor contrast');
  await ap.getByLabel('Brand colour code').fill('#0b6e4f');
  await ap.getByRole('button', { name: 'Save look' }).click();
  await ap.waitForTimeout(1200);
  const tenant = await (await (await apiAs('admin@company.example')).get(`${API}/tenant`)).json();
  check(tenant.brand?.accent === '#0b6e4f' && !!tenant.brand?.logo, `brand saved (accent ${tenant.brand?.accent}, logo ${tenant.brand?.logo})`);
  await shot(ap, '01-settings-look');
  await ap.goto(`${WEB}/dashboard`);
  await ap.waitForLoadState('networkidle');
  const accent = await ap.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--c-red').trim());
  check(accent.toLowerCase() === '#0b6e4f', `the brand colour replaces the action colour (${accent})`);
  check(await ap.locator('aside img[alt]').first().isVisible(), 'the logo shows in the sidebar');
  await shot(ap, '02-dashboard-dark');
  await ap.getByRole('button', { name: /Change theme/ }).first().click();
  let theme = await ap.evaluate(() => document.documentElement.dataset.theme);
  if (theme !== 'light') { await ap.getByRole('button', { name: /Change theme/ }).first().click(); theme = await ap.evaluate(() => document.documentElement.dataset.theme); }
  check(theme === 'light', 'the theme switch turns the light theme on');
  await shot(ap, '03-dashboard-light');
  await ap.reload();
  await ap.waitForLoadState('networkidle');
  check(await ap.evaluate(() => document.documentElement.dataset.theme) === 'light', 'the light theme is remembered after a reload');
  const login = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await login.goto(`${WEB}/login`);
  await login.waitForLoadState('networkidle');
  check(await login.locator('img[src*="/tenant/logo"]').count() > 0, 'the login page shows the logo');
  await login.close();

  // ── A manager sets labour rates ───────────────────────────────────────────
  const mgr = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const mp = await mgr.newPage();
  watch(mp, 'manager');
  await signIn(mp, 'manager@company.example', /\/dashboard/);
  await mp.goto(`${WEB}/settings`);
  await mp.getByLabel('Default rate').waitFor();
  await mp.getByLabel('Default rate').fill('45');
  await mp.getByLabel('Rate for Technician').fill('60');
  await mp.getByRole('button', { name: 'Save rates' }).click();
  await mp.getByText(/New time is costed at these rates/).waitFor({ timeout: 10000 });
  const manager = await apiAs('manager@company.example');
  const rates = await ok(await manager.get(`${API}/labour/rates`), 'rates');
  check(rates.defaultRate === 45 && rates.roleRates.TECHNICIAN === 60, 'rates saved: default 45, technician 60');
  await mp.getByLabel('Default rate').scrollIntoViewIfNeeded();
  await shot(mp, '04-labour-rates');

  // ── The help desk registers a breakdown, asset out of action ─────────────
  const help = await apiAs('helpdesk@company.example');
  const assets = await ok(await help.get(`${API}/assets`), 'assets');
  const asset = assets.find((a) => a.status === 'IN_SERVICE');
  const hd = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const hp = await hd.newPage();
  watch(hp, 'helpdesk');
  await signIn(hp, 'helpdesk@company.example', /\/dashboard/);
  await hp.goto(`${WEB}/jobs`);
  await hp.getByRole('button', { name: /^\+ Register/ }).click();
  await hp.locator('select').filter({ hasText: 'not in the register' }).selectOption(asset.id);
  await hp.getByLabel(/is out of action/).check();
  await hp.locator('label:has-text("Requested by") input').first().fill('Level 2 lobby');
  await shot(hp, '05-register-breakdown');
  await hp.getByRole('button', { name: /^Register — assign/ }).click();
  await hp.waitForURL(/\/jobs\/[^/]+$/, { timeout: 15000 });
  const jobId = decodeURIComponent(hp.url().split('/jobs/')[1]);
  const job = await ok(await help.get(`${API}/jobs/${jobId}`), 'job');
  check(job.assetDown === true, `${jobId} registered with the asset out of action`);
  const a1 = await ok(await help.get(`${API}/assets/${asset.id}`), 'asset');
  check(a1.status === 'OUT_OF_SERVICE', `${asset.tag} is now out of service`);
  await ok(await help.patch(`${API}/jobs/${jobId}/transition`, { data: { to: 'ASSIGNED', fields: { assignee: 'u-technician' } } }), 'assign');

  // ── A technician logs time on a phone with no signal ─────────────────────
  const phone = await browser.newContext({ ...devices['Pixel 7'] });
  const tp = await phone.newPage();
  watch(tp, 'phone');
  await signIn(tp, 'technician@company.example', /\/m$/);
  await tp.evaluate(async () => { await navigator.serviceWorker.ready; });
  await tp.reload();
  await tp.waitForTimeout(1500);
  await tp.goto(`${WEB}/m/job?id=${encodeURIComponent(jobId)}`);
  await tp.getByText('Your time').waitFor({ timeout: 15000 });
  await tp.waitForTimeout(1000);
  await phone.setOffline(true);
  await tp.reload();
  await tp.getByText('Your time').waitFor({ timeout: 15000 });
  await tp.getByRole('button', { name: '+30m' }).click();
  await tp.getByRole('button', { name: '+1h' }).click();
  await tp.getByText(/2 waiting to send/).waitFor({ timeout: 10000 });
  check(true, 'two time entries waiting while offline');
  await tp.getByText('Your time').scrollIntoViewIfNeeded();
  await shot(tp, '06-phone-time-offline');
  await phone.setOffline(false);
  await tp.evaluate(() => window.dispatchEvent(new Event('online')));
  await tp.getByText('All sent').waitFor({ timeout: 30000 });
  const time = await ok(await manager.get(`${API}/jobs/${jobId}/time`), 'time');
  check(time.minutes === 90 && time.entries.length === 2, `time reached the server once (${time.minutes} min in ${time.entries.length} entries)`);
  check(time.cost === 90, `costed at the technician rate (${time.cost})`);
  await tp.waitForTimeout(1000);
  await shot(tp, '07-phone-time-sent');

  // ── The manager sees the work order's cost ───────────────────────────────
  await mp.goto(`${WEB}/jobs/${encodeURIComponent(jobId)}`);
  await mp.getByText(/1 h 30 min/).first().waitFor({ timeout: 15000 });
  await mp.getByLabel('Hours').fill('0');
  await mp.getByLabel('Minutes').fill('45');
  await mp.getByLabel('Note').fill('Supervised the reset');
  await mp.getByRole('button', { name: 'Log time' }).click();
  await mp.getByText(/Logged 45 min/).waitFor({ timeout: 10000 });
  const cost = await ok(await manager.get(`${API}/jobs/${jobId}/cost`), 'cost');
  check(cost.labour.minutes === 135 && cost.total !== null, `job cost includes labour (${cost.labour.minutes} min, ${cost.labour.cost})`);
  const tech = await apiAs('technician@company.example');
  const blind = await ok(await tech.get(`${API}/jobs/${jobId}/cost`), 'cost as technician');
  check(blind.labour.cost === null && blind.total === null, 'a technician does not see labour cost');
  await mp.waitForTimeout(800);
  await mp.locator('text=Time on this').first().scrollIntoViewIfNeeded().catch(() => {});
  await shot(mp, '08-job-cost');

  // ── Back in service; the asset shows its downtime and reliability ────────
  await ap.goto(`${WEB}/assets?id=${encodeURIComponent(asset.id)}`);
  await ap.getByText(/Reliability · last 12 months/).waitFor({ timeout: 15000 });
  check(await ap.getByText('OUT OF ACTION NOW').isVisible(), 'the asset says it is out of action');
  await ap.getByRole('button', { name: 'Back in service' }).click();
  await ap.waitForTimeout(1500);
  const rel = await ok(await manager.get(`${API}/assets/${asset.id}/reliability`), 'reliability');
  check(rel.down === false && rel.downtime.length >= 1 && rel.downtime[0].toAt, 'putting it back in service closes the downtime');
  check(await ap.getByText('still out').count() === 0, 'the downtime history shows an end time');
  await shot(ap, '09-asset-reliability');
  await ap.goto(`${WEB}/dashboard`);
  await ap.waitForLoadState('networkidle');
  check(await ap.getByText(/out of action/i).first().isVisible(), 'the dashboard shows assets out of action');
  check(await ap.getByText(/on time ·/).first().isVisible(), 'the dashboard shows preventive work done on time');
  await shot(ap, '10-dashboard-cards');

  // ── Finance raises an invoice and exports the period to accounting ───────
  const fin = await apiAs('finance@company.example');
  const streams = await ok(await fin.get(`${API}/invoicing/streams`), 'streams');
  const stream = streams.find((s) => !s.perJob) ?? streams[0];
  const inv = await ok(await fin.post(`${API}/invoicing`, { data: { stream: stream.id, ...(stream.perJob ? { jobId } : {}), amountMYR: 1250.5, period: today.slice(0, 7) } }), 'invoice');
  await ok(await fin.patch(`${API}/invoicing/${inv.id}/transition`, { data: { to: 'ISSUED', fields: { invoiceNo: 'INV-PC-0001' } } }), 'issue');
  await ok(await fin.patch(`${API}/invoicing/${inv.id}/transition`, { data: { to: 'SENT', fields: { sentTo: 'accounts@client.example' } } }), 'send');
  await ok(await fin.patch(`${API}/invoicing/${inv.id}/transition`, { data: { to: 'PAID', fields: { paymentRef: 'PAY-PC-1' } } }), 'pay');
  const pdf = await fin.get(`${API}/invoicing/${inv.id}/documents/tax-invoice`);
  const body = await pdf.body();
  fs.writeFileSync(path.join(OUT, 'tax-invoice.pdf'), body);
  check(pdf.ok() && body.subarray(0, 4).toString() === '%PDF' && body.includes('/Subtype /Image'), `the tax invoice PDF embeds the logo (${body.length} bytes)`);

  const fc = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const fp = await fc.newPage();
  watch(fp, 'finance');
  await signIn(fp, 'finance@company.example', /\/dashboard/);
  check(await fp.locator('a[href="/accounting"]').count() > 0, 'finance sees Accounting export in the menu');
  await fp.goto(`${WEB}/accounting`);
  await fp.getByLabel('FROM', { exact: true }).fill(`${today.slice(0, 8)}01`);
  await fp.getByLabel('TO', { exact: true }).fill(today);
  await fp.getByRole('button', { name: /Create batch · 2 items/ }).waitFor({ timeout: 15000 });
  check(true, 'the preview counts the invoice and its payment');
  await shot(fp, '11-accounting-preview');
  await fp.getByRole('button', { name: /Create batch/ }).click();
  await fp.getByText(/EXP-\d{4}-0001 recorded/).waitFor({ timeout: 15000 });
  check(await fp.getByRole('button', { name: 'Nothing new to export' }).isVisible(), 'nothing is offered twice');
  const [dl] = await Promise.all([fp.waitForEvent('download'), fp.getByRole('button', { name: 'EXCEL' }).first().click()]);
  check(/EXP-\d{4}-0001.*\.xlsx$/.test(dl.suggestedFilename()), `downloads the batch (${dl.suggestedFilename()})`);
  const [csv] = await Promise.all([fp.waitForEvent('download'), fp.getByRole('button', { name: 'SALES CSV' }).first().click()]);
  const sales = fs.readFileSync(await csv.path(), 'utf8');
  check(sales.includes('INV-PC-0001') && sales.includes('4000') && sales.includes('1200'), 'the sales CSV carries the invoice and its account codes');
  await shot(fp, '12-accounting-batch');

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  console.log(log.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
