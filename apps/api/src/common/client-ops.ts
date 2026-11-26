import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { catchError, from, mergeMap, Observable, of, throwError } from 'rxjs';
import { PrismaService } from './prisma.service';

const OP_ID = /^[A-Za-z0-9-]{8,64}$/;
const KEEP_DAYS = 30;

/**
 * Offline changes from a phone carry `X-Client-Op: <id>`. A change is applied
 * once: a resend with the same id answers `200 { duplicate: true }` without
 * applying it again. The id is claimed before the change runs (so two resends
 * racing each other cannot both apply) and released if the change fails, so a
 * refused change can be retried.
 */
@Injectable()
export class ClientOpInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: { sub: string } }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const header = req.headers['x-client-op'];
    const id = Array.isArray(header) ? header[0] : header;
    if (!id) return next.handle();
    if (!OP_ID.test(id)) throw new BadRequestException('X-Client-Op must be 8–64 letters, digits or hyphens');

    const claim = this.prisma.clientOp
      .create({ data: { id, userId: req.user?.sub ?? '', path: req.path.slice(0, 200) } })
      .then(() => true)
      .catch((e: { code?: string }) => {
        if (e?.code === 'P2002') return false; // already applied
        throw e;
      });

    return from(claim).pipe(
      mergeMap((fresh) => {
        if (!fresh) {
          res.status(200);
          return of({ duplicate: true });
        }
        return next.handle().pipe(
          catchError((err) => from(this.prisma.clientOp.delete({ where: { id } }).catch(() => undefined)).pipe(mergeMap(() => throwError(() => err)))),
        );
      }),
    );
  }
}

/** Forget replay ids older than 30 days (a phone never holds changes that long). */
export async function pruneClientOps(prisma: PrismaService, now = Date.now()): Promise<number> {
  const res = await prisma.clientOp.deleteMany({ where: { createdAt: { lt: new Date(now - KEEP_DAYS * 86_400_000) } } });
  return res.count;
}

/** When a change was made offline: not more than 5 minutes ahead, not older than 30 days. */
export function offlineTime(at: unknown, now = Date.now()): Date | undefined {
  if (at === undefined || at === null || at === '') return undefined;
  const d = new Date(String(at));
  if (Number.isNaN(d.getTime())) throw new BadRequestException('at must be a date and time');
  if (d.getTime() > now + 5 * 60_000) throw new BadRequestException('at cannot be in the future');
  if (d.getTime() < now - KEEP_DAYS * 86_400_000) throw new BadRequestException('at is more than 30 days ago — changes that old are not accepted');
  return d;
}
