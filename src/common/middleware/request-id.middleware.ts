import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

const REQUEST_ID_HEADER = 'x-request-id';

/** Reuses an inbound X-Request-Id when present (e.g. from a proxy), else mints one. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();

    req.headers[REQUEST_ID_HEADER] = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
