import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown[] = [],
  ) {
    super(message);
  }
}

export function ok(response: Response, data: unknown, nextCursor: string | null = null, status = 200): void {
  response.status(status).json({
    data,
    meta: { requestId: response.locals.requestId ?? "unknown", nextCursor },
  });
}

export function asyncRoute(handler: (request: Request, response: Response, next: NextFunction) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response, next).catch(next);
  };
}

export function errorHandler(error: unknown, request: Request, response: Response, _next: NextFunction): void {
  const requestId = response.locals.requestId ?? "unknown";
  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "validation_failed",
        message: "The request is invalid.",
        requestId,
        details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
    });
    return;
  }
  if (error instanceof HttpError) {
    response.status(error.status).json({
      error: { code: error.code, message: error.message, requestId, details: error.details },
    });
    return;
  }
  const mongoCode = typeof error === "object" && error && "code" in error ? (error as { code: number }).code : undefined;
  if (mongoCode === 11000) {
    response.status(409).json({
      error: { code: "duplicate", message: "A record with this value already exists.", requestId, details: [] },
    });
    return;
  }
  logger.error({ err: error, requestId }, "request failed");
  response.status(500).json({
    error: {
      code: "internal_error",
      message: "Something went wrong.",
      requestId,
      details: [],
    },
  });
}
