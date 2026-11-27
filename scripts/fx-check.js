/**
 * Drives Phase 9 end to end in a browser against a fresh facilities demo
 * (SEED_PACK=facilities; API and a production web build running): finance
 * keeps exchange rates (a rate typed the wrong way round is questioned);
 * purchasing records quotations in US dollars and Singapore dollars and
 * orders the cheapest in Ringgit; the rate moves and stores receive the goods,
 * which go into stock at the receipt-day rate; finance raises a US-dollar
 * invoice, checks the PDF, records a payment at a different rate and sees the
 * exchange loss; the accounting batch carries the currencies and the loss.
 *
 *   ERP_API=http://localhost:4000/api/v1 ERP_WEB=http://localhost:3000 node scripts/fx-check.js
 *
 * Writes screenshots to ./fx-check/. Needs Playwright with Chromium.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium, request: pwRequest } = require('playwright');
const API = process.env.ERP_API || 'http://localhost:4000/api/v1';
const WEB = process.env.ERP_WEB || 'http://localhost:3000';
const OUT = path.resolve('fx-check');
fs.mkdirSync(OUT, { recursive: true });
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
  return res.json();
}
async function signIn(page, email) {
  await page.goto(`${WEB}/login`);
  await page.fill('#email', email);
  await page.fill('#password', 'demo123');
  await page.press('#password', 'Enter');
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
}
/** Open a record in a list unless it already is (lists open the first one on load). */
async function ensureOpen(page, id, marker) {
  await page.getByText(id).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  // Click an empty part of the row: the id itself may be a link elsewhere.
  if (!(await marker().isVisible())) await page.locator('button', { hasText: id }).first().click({ position: { x: 700, y: 12 } });
  await marker().waitFor({ timeout: 15000 });
}
/** The text a compressed PDFKit file shows: inflate each stream, decode the hex strings. */
function pdfText(buf) {
  const s = buf.toString('latin1');
  let out = '';
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    try {
      const body = zlib.inflateSync(Buffer.from(s.slice(start, end), 'latin1')).toString('latin1');
      for (const h of body.matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(h[1], 'hex').toString('latin1');
      out += ' ';
    } catch { /* not a text stream */ }
  }
  return out;
}

(async () => {
  const log = [];
  const check = (pass, what) => { log.push(`${pass ? 'PASS' : 'FAIL'} ${what}`); if (!pass) process.exitCode = 1; };
  const errors = [];
  const watch = (page, who) => {
    page.on('pageerror', (e) => errors.push(`${who}: ${String(e)}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${who}: ${m.text()}`); });
  };
  const browser = await chromium.launch();
  const context = async () => browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });

  // ── Finance keeps the rates ───────────────────────────────────────────────
  const fp = await (await context()).newPage();
  watch(fp, 'finance');
  await signIn(fp, 'finance@company.example');
  await fp.goto(`${WEB}/settings`);
  await fp.getByText(/Exchange rates · against MYR/).waitFor({ timeout: 15000 });
  check(await fp.getByText(/No rates yet/).isVisible(), 'with no rates, everything is in Ringgit only');
  const addRate = async (code, rate) => {
    await fp.locator('select').filter({ hasText: 'USD · US dollar' }).selectOption(code);
    await fp.getByLabel('Rate', { exact: true }).fill(String(rate));
    await fp.getByRole('button', { name: 'Save rate' }).click();
  };
  await addRate('USD', 4.45);
  await fp.getByText(/Saved: USD 1 = RM 4.45/).waitFor({ timeout: 10000 });
  await addRate('SGD', 3.3);
  await fp.getByText(/Saved: SGD 1 = RM 3.3/).waitFor({ timeout: 10000 });
  await addRate('USD', 0.2247);
  await fp.getByText(/95% below the last rate/).waitFor({ timeout: 10000 });
  check(await fp.getByRole('button', { name: /It is right/ }).isVisible(), 'a rate typed the wrong way round is questioned');
  await shot(fp, '01-rates');

  // ── Purchasing compares quotations in three currencies ────────────────────
  const help = await apiAs('helpdesk@company.example');
  const tech = await apiAs('technician@company.example');
  const sup = await apiAs('supervisor@company.example');
  const buy = await apiAs('purchasing@company.example');
  const stores = await apiAs('stores@company.example');
  const fin = await apiAs('finance@company.example');
  const parts = await ok(await stores.get(`${API}/stock/parts`), 'parts');
  const part = parts.find((p) => p.levels?.length) ?? parts[0];
  const store = part.levels?.[0]?.store ?? 'MAIN';
  const job = (await ok(await help.post(`${API}/jobs`, { data: { component: 'Chiller 2 pump', serialNo: 'CH2-P', category: 'HVAC', originUnit: 'Plant room', repairUnit: 'HQ' } }), 'job')).id;
  await ok(await help.patch(`${API}/jobs/${job}/transition`, { data: { to: 'ASSIGNED', fields: { assignee: 'u-technician' } } }), 'assign');
  await ok(await tech.patch(`${API}/jobs/${job}/transition`, { data: { to: 'IN_PROGRESS', fields: {} } }), 'start');
  const held = await ok(await tech.patch(`${API}/jobs/${job}/transition`, { data: { to: 'ON_HOLD_PARTS', fields: { part: part.id, qty: '2' } } }), 'hold');
  const dm = held.demandIds.at(-1);
  await ok(await sup.patch(`${API}/demands/${dm}/transition`, { data: { to: 'APPROVED', fields: {} } }), 'approve');
  await ok(await buy.patch(`${API}/demands/${dm}/transition`, { data: { to: 'QUOTING', fields: { rfqRef: 'RFQ-FX-1' } } }), 'rfq');
  const suppliers = (await ok(await buy.get(`${API}/registers/partners`), 'partners')).filter((p) => p.type === 'SUPPLIER' && p.status === 'REGISTERED');
  await ok(await buy.patch(`${API}/registers/partners/${suppliers[0].id}/currency`, { data: { currency: 'USD' } }), 'usual currency');

  const pp = await (await context()).newPage();
  watch(pp, 'purchasing');
  await signIn(pp, 'purchasing@company.example');
  await pp.goto(`${WEB}/demands`);
  await ensureOpen(pp, dm, () => pp.getByRole('button', { name: '+ Record quotation' }));
  const quoteForm = pp.locator('div').filter({ has: pp.getByRole('button', { name: '+ Record quotation' }) }).last();
  // The first supplier usually quotes in US dollars: choosing them selects USD.
  await quoteForm.locator('select').first().selectOption(suppliers[0].id);
  check(await quoteForm.getByLabel('Price currency').inputValue() === 'USD', "choosing a supplier selects their usual currency");
  await quoteForm.getByLabel('Price', { exact: true }).fill('100');
  await quoteForm.getByText(/= RM 445.00 at 4.45/).waitFor();
  await pp.locator('label:has-text("EDD") input').fill('14');
  await pp.getByRole('button', { name: '+ Record quotation' }).click();
  await pp.getByText('1/3 QUOTES').waitFor({ timeout: 10000 });
  await quoteForm.locator('select').first().selectOption(suppliers[1].id);
  await quoteForm.getByLabel('Price currency').selectOption('SGD');
  await quoteForm.getByLabel('Price', { exact: true }).fill('130');
  await pp.locator('label:has-text("EDD") input').fill('7');
  await pp.getByRole('button', { name: '+ Record quotation' }).click();
  await pp.getByText('2/3 QUOTES').waitFor({ timeout: 10000 });
  check(await pp.getByText('= RM 429.00 at 3.3').first().isVisible(), 'the Singapore quotation shows its Ringgit equivalent');
  await ok(await buy.post(`${API}/demands/${dm}/quotations`, { data: { supplierId: 'SUP-LOCAL', supplier: 'Kedai Ganti Tempatan', priceMYR: 460, eddDays: 3 } }), 'local quote');
  await pp.reload();
  await ensureOpen(pp, dm, () => pp.getByText('LOWEST').first());
  const lowest = await pp.locator('div', { has: pp.getByText('LOWEST') }).filter({ hasText: 'S$' }).count();
  check(lowest > 0, 'the Singapore quotation is the lowest in Ringgit');
  await shot(pp, '02-quotations');
  await ok(await buy.patch(`${API}/demands/${dm}/transition`, { data: { to: 'ORDERED', fields: { poRef: 'PO-FX-1', selectedSupplierId: suppliers[1].id } } }), 'order');

  // ── The rate moves; stores receive the goods ──────────────────────────────
  await ok(await fin.put(`${API}/fx/rates`, { data: { currency: 'SGD', rate: 3.4, effectiveFrom: today } }), 'sgd moves');
  const sp = await (await context()).newPage();
  watch(sp, 'stores');
  await signIn(sp, 'stores@company.example');
  await sp.goto(`${WEB}/demands`);
  await ensureOpen(sp, dm, () => sp.getByRole('button', { name: 'Receive goods' }));
  await sp.getByRole('button', { name: 'Receive goods' }).click();
  await sp.locator('label:has-text("Goods received note") input').fill('GRN-FX-1');
  await sp.locator('label:has-text("Received into store") select').selectOption(store);
  await sp.getByRole('button', { name: /Submit|Hantar/ }).click();
  await sp.getByText(/bought for/).waitFor({ timeout: 15000 });
  const received = await ok(await stores.get(`${API}/demands/${dm}`), 'demand');
  check(received.purchase?.amountBase === 442 && received.unitCost === 221, `received at the day's rate: S$ 130 at 3.4 = RM ${received.purchase?.amountBase}, RM ${received.unitCost} each`);
  check(await sp.getByText('S$ 130.00').first().isVisible(), 'the request shows the purchase in Singapore dollars and Ringgit');
  await shot(sp, '03-received');

  // ── Finance raises a US-dollar invoice and records the payment ────────────
  await fp.goto(`${WEB}/invoicing`);
  await fp.getByRole('button', { name: '+ Raise invoice' }).click();
  const streams = await ok(await fin.get(`${API}/invoicing/streams`), 'streams');
  const stream = streams.find((s) => !s.perJob) ?? streams[0];
  await fp.locator('select').first().selectOption(stream.id);
  if (!stream.perJob) await fp.getByPlaceholder('2026-07').fill(today.slice(0, 7));
  await fp.getByLabel('Amount before tax currency').selectOption('USD');
  await fp.getByLabel('Amount before tax', { exact: true }).fill('1000');
  await fp.getByText(/The rate is fixed when the tax invoice is raised/).waitFor();
  await fp.getByRole('button', { name: 'Draft invoice' }).click();
  await fp.getByText(/provisional: fixed when the tax invoice is raised/).waitFor({ timeout: 15000 });
  const list = await ok(await fin.get(`${API}/invoicing`), 'invoices');
  const inv = list.find((i) => i.currency === 'USD');
  check(inv && inv.total === 1080 && inv.totalMYR === 4806, `drafted in US dollars: ${inv?.currency} ${inv?.total} = RM ${inv?.totalMYR}`);
  await fp.getByRole('button', { name: /Issue tax invoice|Raise tax invoice/ }).first().click();
  await fp.locator('label:has-text("Tax invoice no") input, label:has-text("Invoice no") input').first().fill('INV-FX-0001');
  await fp.getByRole('button', { name: /Submit|Hantar/ }).click();
  await fp.getByText(/fixed when the tax invoice was raised/).waitFor({ timeout: 15000 });
  const pdf = await fin.get(`${API}/invoicing/${inv.id}/documents/tax-invoice`);
  const pdfBuf = await pdf.body();
  fs.writeFileSync(path.join(OUT, 'tax-invoice.pdf'), pdfBuf);
  const text = pdfText(pdfBuf);
  check(/Amount \(USD\)/.test(text) && /USD 1 = MYR 4\.45/.test(text) && /total RM 4,806\.00/.test(text), 'the tax invoice shows US dollars, the rate and the Ringgit amounts');
  check(/US Dollars One Thousand Eighty Only/.test(text), 'the amount in words is in US dollars');
  await ok(await fin.patch(`${API}/invoicing/${inv.id}/transition`, { data: { to: 'SENT', fields: { sentTo: 'ap@client.example' } } }), 'send');
  await fp.reload();
  await ensureOpen(fp, inv.id, () => fp.getByRole('button', { name: /Record payment/ }));
  await fp.getByRole('button', { name: /Record payment/ }).click();
  await fp.locator('label:has-text("Payment ref") input').fill('TT-0042');
  await fp.locator('label:has-text("Amount received") input').fill('4773.60');
  await shot(fp, '04-payment');
  await fp.getByRole('button', { name: /Submit|Hantar/ }).click();
  await fp.getByText('exchange loss RM 32.40', { exact: true }).waitFor({ timeout: 15000 });
  const paid = await ok(await fin.get(`${API}/invoicing/${inv.id}`), 'paid');
  check(paid.paidRate === 4.42 && paid.fxGain === -32.4, `paid at ${paid.paidRate}: exchange loss ${paid.fxGain}`);
  await shot(fp, '05-paid');

  // ── The accounting batch ──────────────────────────────────────────────────
  await fp.goto(`${WEB}/accounting`);
  await fp.getByLabel('FROM', { exact: true }).fill(`${today.slice(0, 8)}01`);
  await fp.getByLabel('TO', { exact: true }).fill(today);
  await fp.getByRole('button', { name: /Create batch/ }).waitFor({ timeout: 15000 });
  check(await fp.getByText('EXCHANGE GAIN / LOSS').isVisible(), 'the gain/loss account code can be set');
  await fp.getByRole('button', { name: /Create batch/ }).click();
  await fp.getByText(/EXP-\d{4}-0001 recorded/).waitFor({ timeout: 15000 });
  const [csv] = await Promise.all([fp.waitForEvent('download'), fp.getByRole('button', { name: 'RECEIPTS CSV' }).first().click()]);
  const receipts = fs.readFileSync(await csv.path(), 'utf8');
  check(/INV-FX-0001,.*,USD,1080\.00,4\.42,4773\.60,-32\.40,7900/.test(receipts), 'the receipts sheet carries the currency, rate, amount received and the loss');
  const [pcsv] = await Promise.all([fp.waitForEvent('download'), fp.getByRole('button', { name: 'PURCHASES CSV' }).first().click()]);
  check(/PO-FX-1,.*,442\.00,.*,SGD,3\.4,130\.00/.test(fs.readFileSync(await pcsv.path(), 'utf8')), 'the purchases sheet carries the purchase in Singapore dollars');
  await shot(fp, '06-accounting');

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  console.log(log.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
