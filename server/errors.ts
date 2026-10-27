/** Safe errors exposed by the HTTP boundary; never forward raw provider responses. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;
  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
