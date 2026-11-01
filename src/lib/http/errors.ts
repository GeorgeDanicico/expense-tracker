type FieldErrors = Record<string, string[] | undefined>;

export type HttpErrorStatus = 400 | 403 | 404 | 413 | 415 | 422 | 429;

/**
 * An expected request failure. `withUser` turns it into `{ error, fieldErrors? }` with its status.
 * It lives on its own (and `@/lib/http/route` re-exports it) so the body reader and the request
 * guard can throw it without importing the route helpers that import them.
 */
export class HttpError extends Error {
  readonly status: HttpErrorStatus;
  readonly fieldErrors?: FieldErrors;

  constructor(status: HttpErrorStatus, message: string, fieldErrors?: FieldErrors) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}
