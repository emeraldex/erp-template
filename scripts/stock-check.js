/**
 * Drives the stock screens in a browser against a running fleet demo
 * (SEED_PACK=fleet; API and a production web build running): catalogue,
 * part panel, receive, reorder → purchase requests, a count, spreadsheet
 * import, labels, purchasing for stock, parts on a work order, a catalogue
 * part chosen in a workflow step, the dashboard card; then the phone part
 * screen and parts on the phone job screen.
 *
 *   ERP_API=http://localhost:4000/api/v1 ERP_WEB=http://localhost:3000 node scripts/stock-check.js
 *
 * Writes screenshots to ./stock-check/. Needs Playwright with Chromium.
 */
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const API = process.env.ERP_API || 'http://localhost:4000/api/v1';
const WEB = process.env.ERP_WEB || 'http://localhost:3000';
const OUT = path.resolve('stock-check');
fs.mkdirSync(OUT, { recursive: true });
// Let entrance animations finish before each screenshot.
const shot = async (page, n) => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true }); };

async function apiAs(pw, email) {
  const ctx = await pw.request.newContext({ baseURL: API, extraHTTPHeaders: { 'X-Requested-With': 'erp-web', Origin: WEB } });
  const r = await ctx.post(`${API}/auth/login`, { data: { email, password: 'demo123' } });
  if (!r.ok()) throw new Error(`login ${email}: ${r.status()}`);
  return ctx;
}

async function signIn(page, email, landing) {
  await page.goto(`${WEB}/login`);
  await page.waitForLoadState('networkidle');
  await page.fill('#email', email);
  await page.fill('#password', 'demo123');
  await page.press('#password', 'Enter');
  await page.waitForURL(landing, { timeout: 30000 });
}

(async () => {
  const pw = require('playwright');
  const log = [];
  const check = (ok, what) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
  const stores = await apiAs(pw, 'stores@company.example');
  const help = await apiAs(pw, 'helpdesk@company.example');
  const parts = await (await stores.get(`${API}/stock/parts`)).json();
  const part = parts.find((p) => p.onHand > 5) ?? parts[0];
  log.push(`part ${part.partNo} (${part.id}), ${parts.length} parts`);
  const job = await (await help.post(`${API}/jobs`, { data: { component: 'Van WXY 9100', partNo: 'Hiace', serialNo: `WXY${Date.now()}`, category: 'SERVICE', originUnit: 'Deliveries', repairUnit: 'HQ' } })).json();
  log.push(`job ${job.id}`);

  const browser = await chromium.launch();
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await desk.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  await signIn(page, 'stores@company.example', /\/dashboard/);
  await page.waitForSelector('text=Low stock', { timeout: 15000 });
  check(true, 'dashboard shows the low-stock card');
  await shot(page, '01-dashboard');

  // Catalogue and the part panel.
  await page.click('nav >> text=Parts & stock');
  await page.waitForSelector(`text=${part.partNo}`);
  check(await page.locator('tbody tr').count() >= 10, 'catalogue lists the demo parts');
  await shot(page, '02-catalogue');
  await page.click(`tbody tr:has-text("${part.partNo}")`);
  await page.waitForSelector('text=Ledger · latest 50');
  await page.getByRole('button', { name: 'RECEIVE', exact: true }).click();
  await page.getByLabel('Quantity (').fill('5');
  await page.getByLabel('Unit cost (RM)').fill('20');
  await page.getByLabel('Where it came from').fill('Free issue from dealer');
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  await page.waitForSelector('text=Received 5');
  check(true, 'receives stock from the part panel');
  await shot(page, '03-part-panel');

  // Reorder → purchase requests.
  await page.getByRole('button', { name: 'REORDER', exact: true }).click();
  await page.waitForSelector('th:has-text("Est. cost")');
  await page.waitForSelector('tbody tr');
  const lines = await page.locator('tbody tr').count();
  check(await page.getByRole('button', { name: 'REORDER', exact: true }).evaluate((el) => el.className.includes('text-trace')), 'the reorder tab is highlighted');
  await shot(page, '04-reorder');
  await page.click('button:has-text("Raise")');
  await page.waitForSelector('text=Raised');
  check(lines > 0, `reorder list has ${lines} line(s) and raises purchase requests`);
  await shot(page, '05-reorder-raised');

  // A count.
  await page.getByRole('button', { name: 'COUNTS', exact: true }).click();
  await page.waitForSelector('text=Start a count');
  await page.click('button:has-text("Start count")');
  await page.waitForSelector('text=ALL COUNTS');
  const first = page.locator('[data-count-row="0"]');
  await first.fill('3');
  await first.press('Enter');
  check(await page.locator('[data-count-row="1"]').evaluate((el) => el === document.activeElement), 'Enter moves to the next count line');
  await shot(page, '06-count-sheet');
  await page.click('button:has-text("Post count")');
  await page.waitForSelector('text=Count posted');
  check(true, 'posts a count');
  await shot(page, '07-count-posted');

  // Spreadsheet import.
  await page.getByRole('button', { name: 'PARTS', exact: true }).click();
  await page.click('button:has-text("Import from spreadsheet")');
  const csv = path.join(OUT, 'parts.csv');
  const tag = `BRW-${Date.now().toString(36).toUpperCase()}`;
  fs.writeFileSync(csv, `partNo,name,unit,group,store,bin,qty,unitCost,reorderPoint\n${tag},Browser test wiper,EA,ELECTRICAL,MAIN,Z-9,4,11.5,2\n${tag}-X,,EA,,MAIN,,,,\n`);
  await page.setInputFiles('input[type=file]', csv);
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await page.waitForSelector('text=Row 3:');
  check(true, 'import check lists a bad row');
  await shot(page, '08-import-errors');
  fs.writeFileSync(csv, `partNo,name,unit,group,store,bin,qty,unitCost,reorderPoint\n${tag},Browser test wiper,EA,ELECTRICAL,MAIN,Z-9,4,11.5,2\n`);
  await page.click('button:has-text("Choose another file")').catch(() => {});
  await page.setInputFiles('input[type=file]', csv);
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await page.click('button:has-text("Import 1 row")');
  await page.waitForSelector('text=Imported 1 row');
  await page.waitForSelector(`text=${tag}`);
  check(true, 'imports a good file and lists the new part');

  // Labels.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Print labels")')]);
  check(/part-labels-\d+\.pdf/.test(dl.suggestedFilename()), `downloads ${dl.suggestedFilename()}`);

  // Purchasing: requests for stock.
  await page.goto(`${WEB}/demands`);
  await page.waitForLoadState('networkidle');
  await page.click('button:has-text("FOR STOCK")');
  await page.waitForSelector('text=↳ FOR STOCK');
  check(true, 'purchasing shows requests for stock');
  await page.locator('text=↳ FOR STOCK').first().click();
  await page.waitForSelector('text=CATALOGUE PART');
  await shot(page, '09-purchasing-for-stock');

  // Work order: parts used.
  await page.goto(`${WEB}/jobs/${job.id}`);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('text=Parts used');
  await page.click('button:has-text("+ ISSUE PART")');
  await page.getByLabel('Part').selectOption(part.id);
  await page.getByLabel('Quantity').fill('2');
  await page.click('button:has-text("Issue to this work order")');
  await page.waitForSelector('text=PARTS COST');
  check(true, 'issues a part from the work order page');
  await shot(page, '10-job-parts');

  // A workflow step asking for a catalogue part (the parts request step).
  const cfg = await (await stores.get(`${API}/config`)).json();
  const rule = cfg.jobTransitions.find((t) => t.requires.some((f) => f.type === 'part'));
  check(!!rule, `a job step asks for a catalogue part (${rule && rule.label})`);
  if (rule) {
    const path1 = [];
    // Walk the job to the step's starting status through steps without fields where possible.
    const tech = await apiAs(pw, 'technician@company.example');
    const sup = await apiAs(pw, 'supervisor@company.example');
    const actors = [help, sup, tech, stores];
    for (let i = 0; i < 6; i++) {
      const j = await (await help.get(`${API}/jobs/${job.id}`)).json();
      if (j.status === rule.from) break;
      const next = cfg.jobTransitions.find((t) => t.from === j.status && t.to !== 'CANCELLED' && !t.requires.some((f) => !f.optional && ['photo', 'signature'].includes(f.type)));
      if (!next) break;
      const fields = Object.fromEntries(next.requires.filter((f) => !f.optional).map((f) => [f.key, f.type === 'user' ? 'u-technician' : f.type === 'number' ? '1' : f.type === 'date' ? '2026-11-26' : 'x']));
      for (const a of actors) {
        const r = await a.patch(`${API}/jobs/${job.id}/transition`, { data: { to: next.to, fields } });
        if (r.ok()) { path1.push(next.to); break; }
      }
    }
    log.push(`walked job to ${path1.join(' → ') || '(no change)'}`);
    const techDesk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const tp = await techDesk.newPage();
    tp.on('pageerror', (e) => errors.push(`technician: ${String(e)}`));
    await signIn(tp, 'technician@company.example', /\/(dashboard|m)/);
    await tp.goto(`${WEB}/jobs/${job.id}`);
  await tp.waitForLoadState('networkidle');
    const button = tp.getByRole('button', { name: rule.label, exact: true }).first();
    await button.waitFor({ timeout: 15000 }).catch(() => {});
    if (await button.count()) {
      await button.click();
      await tp.waitForSelector('text=(optional)');
      await tp.locator('input[placeholder="Search part no. or name…"]').first().fill(part.partNo);
      await tp.waitForSelector(`option:has-text("${part.partNo}")`, { state: 'attached', timeout: 10000 }).catch(() => {});
      await shot(tp, '11-step-part-picker');
      check(await tp.locator(`option:has-text("${part.partNo}")`).count() > 0, 'step form part picker finds the part');
      const picker = tp.locator('select').filter({ has: tp.locator(`option:has-text("${part.partNo}")`) }).first();
      check(await picker.inputValue() === part.id, 'a search that leaves one part chooses it');
      const qtyField = rule.requires.find((f) => f.type === 'number' && !f.optional);
      if (qtyField) await tp.getByLabel(qtyField.label).fill('1');
      await tp.getByRole('button', { name: 'Submit', exact: true }).click();
      await tp.waitForSelector(`text=${rule.to.replace(/_/g, ' ')}`, { timeout: 10000 }).catch(() => {});
      const demands = await (await stores.get(`${API}/demands`)).json();
      const raised = demands.find((d) => d.jobId === job.id && d.partId === part.id);
      check(!!raised, `the step raised a parts request for the catalogue part${raised ? ` (${raised.id})` : ''}`);
      await techDesk.close();
    } else {
      check(false, `reached the "${rule.label}" step on the work order page`);
    }
  }

  // Workflow editor shows the optional tick and the new types.
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const ap = await adminCtx.newPage();
  ap.on('pageerror', (e) => errors.push(`admin: ${String(e)}`));
  await signIn(ap, 'admin@company.example', /\/dashboard/);
  await ap.goto(`${WEB}/workflow`);
  await ap.waitForLoadState('networkidle');
  await ap.waitForSelector('text=OPTIONAL', { timeout: 15000 }).catch(() => {});
  check(await ap.locator('text=OPTIONAL').count() > 0, 'workflow editor has the optional tick');
  await shot(ap, '14-workflow-editor');

  // Phone.
  const phone = await browser.newContext({ ...devices['Pixel 7'] });
  const mp = await phone.newPage();
  mp.on('pageerror', (e) => errors.push(`phone: ${String(e)}`));
  await signIn(mp, 'technician@company.example', /\/m$/);
  await mp.goto(`${WEB}/stock?part=${encodeURIComponent(part.id)}`);
  await mp.waitForLoadState('networkidle');
  await mp.waitForURL(/\/m\/part\?id=/, { timeout: 15000 });
  check(true, 'a narrow screen opening /stock?part= goes to the phone part screen');
  await mp.waitForSelector('text=Stock by store');
  await shot(mp, '12-phone-part');
  await mp.click('button:has-text("Issue to a work order")');
  await mp.fill('input[placeholder="WO-2026-0001"]', job.id);
  await mp.getByRole('button', { name: 'Issue', exact: true }).click();
  await mp.waitForSelector('text=Issued:');
  check(true, 'issues to a work order from the phone part screen');
  await mp.goto(`${WEB}/m/job?id=${job.id}`);
  await mp.waitForLoadState('networkidle');
  await mp.waitForSelector('text=Parts used');
  await mp.waitForSelector('text=Parts cost');
  await mp.locator('text=Parts used').scrollIntoViewIfNeeded();
  await shot(mp, '13-phone-job-parts');
  const used = await (await stores.get(`${API}/jobs/${job.id}/parts`)).json();
  check(used.lines.some((l) => l.partId === part.id && l.qty === 3), `work order shows ${JSON.stringify(used.lines.map((l) => [l.partNo, l.qty]))}`);

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  console.log(log.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
