/**
 * Seeds a fresh database from the reference dataset in common/seed.ts and the
 * workflow rules in common/workflow-config.ts.
 *
 * Idempotent: skips entirely if users already exist, so re-running `migrate
 * deploy && seed` on an existing volume never duplicates or clobbers live data.
 * Force a reseed of an empty-but-migrated database with SEED_FORCE=1.
 *
 * Passwords: the reference dataset ships plaintext demo credentials. Every one
 * is scrypt-hashed here — the plaintext never reaches the database. Override
 * them with SEED_PASSWORD, and change them before any real deployment.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { hashPassword } from './common/password';
import { fromBranch } from './common/mappers';
import {
  DEMANDS, FOD_INCIDENTS, INVOICES, JOBS, OV_REPAIRS, PARTNERS, TOOLS, TRAINING, USERS, WEEKLY_CLOSURES,
} from './common/seed';
import {
  DEMAND_TRANSITIONS, INVOICE_STREAMS, INVOICE_TRANSITIONS, JOB_TRANSITIONS, OV_TRANSITIONS, SLA_RULES,
} from './common/workflow-config';
import type { AuditEntry, FormRecord } from './common/types';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required to seed.');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const auditRows = (a: AuditEntry[] = []) =>
  a.map((x, i) => ({ at: new Date(x.at), by: x.by, role: x.role as never, action: x.action, fields: x.fields ?? undefined, seq: i }));
const recordRows = (r: FormRecord[] = []) =>
  r.map((x, i) => ({ formNo: x.formNo, refNo: x.refNo, date: x.date, by: x.by, note: x.note ?? null, seq: i }));

/** Higher ordinal sorts first, so seed order is preserved as written. */
const ord = (total: number, i: number) => total - i;

async function main() {
  const existing = await prisma.user.count();
  if (existing > 0 && process.env.SEED_FORCE !== '1') {
    console.log(`Database already seeded (${existing} users) — nothing to do.`);
    return;
  }

  // ─── workflow-as-data (FR-02) ───────────────────────────────────────────────
  const kinds = [
    ['JOB', JOB_TRANSITIONS], ['DEMAND', DEMAND_TRANSITIONS],
    ['OV', OV_TRANSITIONS], ['INVOICE', INVOICE_TRANSITIONS],
  ] as const;
  for (const [kind, rules] of kinds) {
    for (const [i, r] of rules.entries()) {
      const data = {
        kind: kind as never, from: r.from, to: r.to, label: r.label, labelMs: r.labelMs,
        roles: r.roles as never, requires: r.requires as never,
        setLocation: (r.setLocation ?? null) as never, seq: i,
      };
      await prisma.transitionRuleRow.upsert({
        where: { kind_from_to: { kind: kind as never, from: r.from, to: r.to } },
        create: data,
        update: data,
      });
    }
  }
  for (const [i, s] of SLA_RULES.entries()) {
    const data = { entity: s.entity as never, status: s.status, days: s.days, rule: s.rule, source: s.source, seq: i };
    await prisma.slaRule.upsert({ where: { id: s.id }, create: { id: s.id, ...data }, update: data });
  }
  for (const [i, s] of INVOICE_STREAMS.entries()) {
    const data = {
      label: s.label, labelMs: s.labelMs, customer: s.customer, perJob: s.perJob,
      docSet: s.docSet, deadlines: s.deadlines as never, seq: i,
    };
    await prisma.invoiceStreamDef.upsert({ where: { id: s.id as never }, create: { id: s.id as never, ...data }, update: data });
  }
  for (const [week, count] of WEEKLY_CLOSURES.entries()) {
    await prisma.weeklyClosure.upsert({ where: { week }, create: { week, count }, update: { count } });
  }
  console.log('Workflow config seeded.');

  // ─── actors ─────────────────────────────────────────────────────────────────
  for (const u of USERS) {
    const passwordHash = await hashPassword(process.env.SEED_PASSWORD ?? u.password);
    const data = {
      name: u.name, email: u.email, passwordHash, role: u.role as never,
      designation: u.designation, branch: fromBranch(u.branch) as never,
    };
    await prisma.user.upsert({ where: { id: u.id }, create: { id: u.id, ...data }, update: data });
  }
  console.log(`${USERS.length} users seeded (scrypt-hashed).`);

  // ─── jobs (parents first: demands, OV and invoices reference them) ──────────
  for (const [i, j] of JOBS.entries()) {
    await prisma.job.create({
      data: {
        id: j.id, psDate: j.psDate, component: j.component, partNo: j.partNo, serialNo: j.serialNo,
        category: j.category as never, originUnit: j.originUnit, repairUnit: fromBranch(j.repairUnit) as never,
        status: j.status as never, location: j.location as never,
        receivedAt: new Date(j.receivedAt), statusSince: new Date(j.statusSince),
        indentRef: j.indentRef ?? null, ovId: j.ovId ?? null, ordinal: ord(JOBS.length, i),
        records: { create: recordRows(j.records) },
        audit: { create: auditRows(j.audit) },
        ...(j.priority
          ? {
              priority: {
                create: {
                  type: j.priority.type as never, quantity: j.priority.quantity,
                  route: j.priority.route as never, suffixK: j.priority.suffixK,
                  state: j.priority.state as never, colRef: j.priority.colRef,
                  raisedAt: new Date(j.priority.raisedAt), raisedBy: j.priority.raisedBy,
                  edd: j.priority.edd ?? null, remark: j.priority.remark ?? null,
                  closedAt: j.priority.closedAt ? new Date(j.priority.closedAt) : null,
                  closeReason: (j.priority.closeReason ?? null) as never,
                  audit: { create: auditRows(j.priority.audit) },
                },
              },
            }
          : {}),
      },
    });
  }

  for (const [i, d] of DEMANDS.entries()) {
    await prisma.demand.create({
      data: {
        id: d.id, jobId: d.jobId, partDescription: d.partDescription, partNo: d.partNo, qty: d.qty,
        status: d.status as never, statusSince: new Date(d.statusSince), raisedBy: d.raisedBy,
        branch: fromBranch(d.branch) as never, ordinal: ord(DEMANDS.length, i),
        stockF244Ref: d.stockCheck?.f244Ref ?? null,
        stockAvailable: d.stockCheck?.available ?? null,
        stockHoldingUnit: d.stockCheck?.holdingUnit ?? null,
        rfqRef: d.rfqRef ?? null,
        evalF221Ref: d.evaluation?.f221Ref ?? null,
        evalSupplierId: d.evaluation?.selectedSupplierId ?? null,
        evalLocalPurchase: d.evaluation?.localPurchase ?? null,
        evalF241Ref: d.evaluation?.f241Ref ?? null,
        poRef: d.poRef ?? null,
        discF217Ref: d.discrepancy?.f217Ref ?? null,
        discNote: d.discrepancy?.note ?? null,
        records: { create: recordRows(d.records) },
        audit: { create: auditRows(d.audit) },
        quotations: { create: d.quotations.map((q, k) => ({ ...q, remarks: q.remarks ?? null, seq: k })) },
      },
    });
  }

  for (const [i, o] of OV_REPAIRS.entries()) {
    await prisma.ovRepair.create({
      data: {
        id: o.id, jobId: o.jobId, defectReportRef: o.defectReportRef, am75Ref: o.am75Ref,
        vendorId: o.vendorId ?? null, vendorName: o.vendorName ?? null, f134Ref: o.f134Ref ?? null,
        poRef: o.poRef ?? null, costMYR: o.costMYR ?? null, eddDays: o.eddDays ?? null,
        aboveIndent: o.aboveIndent ?? null, f119Ref: o.f119Ref ?? null,
        status: o.status as never, statusSince: new Date(o.statusSince), ordinal: ord(OV_REPAIRS.length, i),
        records: { create: recordRows(o.records) },
        audit: { create: auditRows(o.audit) },
      },
    });
  }

  for (const [i, inv] of INVOICES.entries()) {
    await prisma.invoice.create({
      data: {
        id: inv.id, stream: inv.stream as never, jobId: inv.jobId ?? null, customer: inv.customer,
        period: inv.period ?? null, amountMYR: inv.amountMYR, gstRate: inv.gstRate,
        gstMYR: inv.gstMYR, totalMYR: inv.totalMYR, status: inv.status as never,
        statusSince: new Date(inv.statusSince), f311Ref: inv.f311Ref ?? null, ctcRef: inv.ctcRef ?? null,
        customerSignRef: inv.customerSignRef ?? null, correctnessBy: inv.correctnessBy ?? null,
        salesPerfRef: inv.salesPerfRef ?? null, paymentRef: inv.paymentRef ?? null,
        paidAt: inv.paidAt ?? null, outstanding: inv.outstanding, raisedBy: inv.raisedBy,
        branch: fromBranch(inv.branch) as never, ordinal: ord(INVOICES.length, i),
        records: { create: recordRows(inv.records) },
        audit: { create: auditRows(inv.audit) },
      },
    });
  }

  for (const [i, p] of PARTNERS.entries()) {
    await prisma.partner.create({
      data: {
        id: p.id, name: p.name, type: p.type as never, status: p.status as never, country: p.country,
        certifications: p.certifications, lists: p.lists, rating: p.rating ?? null,
        evaluationRef: p.evaluationRef ?? null, siteAuditRef: p.siteAuditRef ?? null,
        lastAssessed: p.lastAssessed ?? null, nextReassessment: p.nextReassessment ?? null,
        nonConformances: p.nonConformances, factorsEvaluated: p.factorsEvaluated,
        ordinal: ord(PARTNERS.length, i),
        audit: { create: auditRows(p.audit) },
        cars: { create: p.cars.map((c, k) => ({ ...c, seq: k })) },
      },
    });
  }

  for (const [i, f] of FOD_INCIDENTS.entries()) {
    await prisma.fodIncident.create({
      data: {
        id: f.id, date: f.date, partName: f.partName, typeModel: f.typeModel, serialNo: f.serialNo,
        area: f.area as never, location: f.location, discovered: f.discovered,
        rootCause: f.rootCause ?? null, correctiveAction: f.correctiveAction ?? null,
        reporter: f.reporter, focalPoint: f.focalPoint, status: f.status as never,
        ordinal: ord(FOD_INCIDENTS.length, i),
        audit: { create: auditRows(f.audit) },
      },
    });
  }

  for (const [i, t] of TOOLS.entries()) {
    await prisma.tool.create({
      data: {
        tag: t.tag, name: t.name, board: t.board, holder: t.holder ?? null,
        status: t.status as never, since: new Date(t.since), ordinal: i + 1,
      },
    });
  }

  for (const [i, t] of TRAINING.entries()) {
    await prisma.trainingRecord.create({
      data: { person: t.person, course: t.course as never, date: t.date, nextDue: t.nextDue, ordinal: i + 1 },
    });
  }

  console.log(
    `Seeded ${JOBS.length} jobs · ${DEMANDS.length} demands · ${OV_REPAIRS.length} OV repairs · ` +
    `${INVOICES.length} invoices · ${PARTNERS.length} partners · ${FOD_INCIDENTS.length} FOD incidents · ` +
    `${TOOLS.length} tools · ${TRAINING.length} training records.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
