/**
 * Thrown by SSSClient when the backend returns a non-success response
 * or when the HTTP status is not ok.
 */
export class SSSError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "SSSError";
    this.statusCode = statusCode;
    // Ensure correct prototype chain for instanceof checks
    Object.setPrototypeOf(this, SSSError.prototype);
  }
}
