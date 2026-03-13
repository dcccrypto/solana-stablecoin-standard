/**
 * Custom error class for SSS REST API errors.
 */
export class SSSError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "SSSError";
    this.statusCode = statusCode;
    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, SSSError.prototype);
  }
}
