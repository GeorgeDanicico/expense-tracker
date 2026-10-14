/** An expected failure of a domain operation, mapped to its HTTP status by routes and to a tool error by MCP. */
export class DomainError extends Error {
  readonly status: 404 | 409 | 422;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    message: string,
    status: 404 | 409 | 422,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "DomainError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}
