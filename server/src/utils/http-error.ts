export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly publicMessage: string | undefined;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.publicMessage = message;
    Error.captureStackTrace?.(this, HttpError);
  }
}

export const badRequest = (code: string, message?: string): HttpError =>
  new HttpError(400, code, message);

export const unauthorized = (code = 'unauthorized', message?: string): HttpError =>
  new HttpError(401, code, message);

export const forbidden = (code = 'forbidden', message?: string): HttpError =>
  new HttpError(403, code, message);

export const notFound = (code = 'not_found', message?: string): HttpError =>
  new HttpError(404, code, message);

export const conflict = (code = 'conflict', message?: string): HttpError =>
  new HttpError(409, code, message);
