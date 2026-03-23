/**
 * Output formatting helpers for the CLI.
 * Supports --output text|json global flag.
 */

export type OutputFormat = "text" | "json";

let currentFormat: OutputFormat = "text";

export function setOutputFormat(fmt: string): void {
  if (fmt === "json" || fmt === "text") {
    currentFormat = fmt;
  }
}

export function getOutputFormat(): OutputFormat {
  return currentFormat;
}

/**
 * Print structured output. In text mode, prints key-value pairs.
 * In JSON mode, prints a single JSON object.
 */
export function printResult(data: Record<string, unknown>): void {
  if (currentFormat === "json") {
    console.log(JSON.stringify(data, replacer, 2));
  } else {
    for (const [key, value] of Object.entries(data)) {
      console.log(`${key}: ${String(value)}`);
    }
  }
}

/**
 * Print a success message for write operations.
 */
export function printTx(label: string, data: Record<string, unknown>): void {
  if (currentFormat === "json") {
    console.log(JSON.stringify({ status: "ok", operation: label, ...data }, replacer, 2));
  } else {
    console.log(label);
    for (const [key, value] of Object.entries(data)) {
      console.log(`  ${key}: ${String(value)}`);
    }
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}
