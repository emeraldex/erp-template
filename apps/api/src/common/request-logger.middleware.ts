import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * One line per request: method, path, status, duration and the acting user.
 * Never logs bodies, query strings or headers, so passwords, tokens and record
 * contents stay out of the logs.
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly log = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      if (req.path.endsWith('/health')) return;
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const user = (req as Request & { user?: { sub: string } }).user?.sub ?? '-';
      const line = `${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(1)}ms user=${user}`;
      if (res.statusCode >= 500) this.log.error(line);
      else if (res.statusCode >= 400) this.log.warn(line);
      else this.log.log(line);
    });
    next();
  }
}
