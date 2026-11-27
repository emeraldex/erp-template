import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../common/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * Spells when an asset is out of action. One open spell per asset at a time
 * (each change takes a per-asset lock). Opening a spell puts the asset out of
 * service; closing the last one puts it back in service.
 */
@Injectable()
export class DowntimeService {
  constructor(private readonly prisma: PrismaService) {}

  private async lock(tx: Tx, assetId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':downtime:' || ${assetId}))`;
  }

  /** The asset is out of action from now (or `at`), for a work order or by hand. Returns the open spell. */
  async open(assetId: string, o: { jobId?: string; reason: string; by: string; at?: Date }) {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, assetId);
      const open = await tx.assetDowntime.findFirst({ where: { assetId, toAt: null } });
      if (open) {
        // Already down: link the work order if the spell has none yet.
        if (o.jobId && !open.jobId) return tx.assetDowntime.update({ where: { id: open.id }, data: { jobId: o.jobId } });
        return open;
      }
      await tx.asset.updateMany({ where: { id: assetId, status: 'IN_SERVICE' }, data: { status: 'OUT_OF_SERVICE', version: { increment: 1 } } });
      return tx.assetDowntime.create({ data: { assetId, fromAt: o.at ?? new Date(), jobId: o.jobId ?? null, reason: o.reason.slice(0, 200), openedBy: o.by } });
    });
  }

  private async close(tx: Tx, assetId: string, where: Prisma.AssetDowntimeWhereInput, by: string, at: Date) {
    const res = await tx.assetDowntime.updateMany({ where: { assetId, toAt: null, ...where }, data: { toAt: at, closedBy: by } });
    if (res.count && !(await tx.assetDowntime.count({ where: { assetId, toAt: null } }))) {
      await tx.asset.updateMany({ where: { id: assetId, status: 'OUT_OF_SERVICE' }, data: { status: 'IN_SERVICE', version: { increment: 1 } } });
    }
    return res.count;
  }

  /** The work order is done: the asset is back. */
  async closeForJob(jobId: string, by: string, at = new Date()): Promise<number> {
    const spells = await this.prisma.assetDowntime.findMany({ where: { jobId, toAt: null }, select: { assetId: true } });
    let closed = 0;
    for (const s of spells) {
      closed += await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, s.assetId);
        return this.close(tx, s.assetId, { jobId }, by, at);
      });
    }
    return closed;
  }

  /** Put back in service by hand: close whatever is open. */
  async closeForAsset(assetId: string, by: string, at = new Date()): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, assetId);
      return this.close(tx, assetId, {}, by, at);
    });
  }

  async list(assetId: string, take = 50) {
    const rows = await this.prisma.assetDowntime.findMany({ where: { assetId }, orderBy: { fromAt: 'desc' }, take });
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id, fromAt: r.fromAt.toISOString(), toAt: r.toAt?.toISOString() ?? null, jobId: r.jobId, reason: r.reason,
      openedBy: r.openedBy, closedBy: r.closedBy, hours: Math.round((((r.toAt?.getTime() ?? now) - r.fromAt.getTime()) / 3_600_000) * 10) / 10,
    }));
  }
}
