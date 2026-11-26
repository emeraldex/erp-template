import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import { Report } from '../reports/tabular';

const DAY = 86_400_000;
export const archiveAfterDays = () => Number(process.env.ARCHIVE_AFTER_DAYS || 365);
export const retentionYears = () => Number(process.env.RETENTION_YEARS || 5);

/** Date a record closed on `closed` may first be considered for disposal. */
export function retainUntil(closed: Date, years = retentionYears()): Date {
  const d = new Date(closed);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

/**
 * FR-12 — retention and archival. Jobs closed for longer than
 * ARCHIVE_AFTER_DAYS leave the active lists but stay readable with their full
 * audit trail. Nothing is ever deleted automatically: records past the
 * RETENTION_YEARS minimum are only listed for a human disposal decision.
 */
@Injectable()
export class RetentionService {
  private readonly log = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService, private readonly store: StoreService) {}

  async archiveClosedJobs(now = Date.now()): Promise<{ archived: number }> {
    const cutoff = new Date(now - archiveAfterDays() * DAY);
    const res = await this.prisma.job.updateMany({
      where: { status: { in: this.store.finalStatuses('JOB') }, archivedAt: null, statusSince: { lt: cutoff } },
      data: { archivedAt: new Date(now) },
    });
    if (res.count) this.log.log(`Archived ${res.count} job(s) closed before ${cutoff.toISOString().slice(0, 10)}`);
    return { archived: res.count };
  }

  async report(now = Date.now()): Promise<Report> {
    const closed = await this.prisma.job.findMany({
      where: { status: { in: this.store.finalStatuses('JOB') } },
      select: { id: true, component: true, serialNo: true, statusSince: true, archivedAt: true },
      orderBy: { statusSince: 'asc' },
    });
    const rows = closed.map((j) => {
      const until = retainUntil(j.statusSince);
      return {
        id: j.id, component: j.component, serialNo: j.serialNo,
        closed: j.statusSince.toISOString().slice(0, 10),
        archived: j.archivedAt ? j.archivedAt.toISOString().slice(0, 10) : '',
        retainUntil: until.toISOString().slice(0, 10),
        state: until.getTime() <= now ? 'Past retention — review for disposal' : j.archivedAt ? 'Archived' : 'Closed (active list)',
      };
    });
    return {
      title: 'Record retention',
      subtitle: `Closed jobs · archive after ${archiveAfterDays()} days · retain at least ${retentionYears()} years · as at ${new Date(now).toISOString().slice(0, 10)}`,
      sheets: [{
        name: 'Retention',
        columns: [
          { key: 'id', header: 'Job (PS no.)', width: 15 }, { key: 'component', header: 'Component', width: 32 },
          { key: 'serialNo', header: 'Serial no.', width: 14 }, { key: 'closed', header: 'Closed', type: 'date', width: 12 },
          { key: 'archived', header: 'Archived', type: 'date', width: 12 }, { key: 'retainUntil', header: 'Retain until', type: 'date', width: 13 },
          { key: 'state', header: 'State', width: 34 },
        ],
        rows,
      }],
    };
  }
}
