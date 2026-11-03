export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'LOCKED'
  | 'INSUFFICIENT_STOCK'
  | 'INTERNAL';

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  LOCKED: 423,
  INSUFFICIENT_STOCK: 409,
  INTERNAL: 500,
};

export interface AppErrorOptions {
  fields?: Record<string, string>;
  retryAfter?: number;
  /** Override the default status for the code (e.g. 413 for an oversized body). */
  status?: number;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly retryAfter?: number;

  constructor(code: ErrorCode, message: string, opts: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = opts.status ?? STATUS_BY_CODE[code];
    if (opts.fields) this.fields = opts.fields;
    if (opts.retryAfter !== undefined) this.retryAfter = opts.retryAfter;
  }
}

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string>;
    retryAfter?: number;
  };
}
