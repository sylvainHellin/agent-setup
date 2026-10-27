export type SmartBoundaryTarget = "boundary" | "interval";

export type SmartBoundaryParseResult =
  | { ok: true; action: "show" }
  | { ok: true; action: "reset"; target: SmartBoundaryTarget | "all" }
  | {
      ok: true;
      action: "set";
      target: SmartBoundaryTarget;
      tokens: number;
      boundaryTokens?: number;
      intervalTokens?: number;
    }
  | { ok: false; action: "error"; message: string };

const INTEGER_TOKENS_PATTERN = /^[0-9]+$/;
const K_TOKENS_PATTERN = /^([0-9]+)k$/i;
const MAX_SAFE_TOKEN_COUNT = BigInt(Number.MAX_SAFE_INTEGER);

const BOUNDARY_ERROR =
  "Invalid smart boundary. Use a positive whole-number token count, such as 120k or 120000, 'interval <tokens>', or 'reset'.";
const INTERVAL_ERROR =
  "Invalid escalation interval. Use a positive whole-number token count, such as 40k or 40000, or 'interval reset'.";

export function parseSmartBoundaryInput(input: string | undefined | null): SmartBoundaryParseResult {
  const trimmed = String(input ?? "").trim();

  if (trimmed.length === 0) {
    return { ok: true, action: "show" };
  }

  if (trimmed.toLowerCase() === "reset") {
    return { ok: true, action: "reset", target: "all" };
  }

  const intervalMatch = /^interval\b\s*(.*)$/i.exec(trimmed);
  if (intervalMatch) {
    return parseIntervalArgument(intervalMatch[1] ?? "");
  }

  const parsedTokens = parseTokenValue(trimmed);
  if (parsedTokens === undefined) {
    return { ok: false, action: "error", message: BOUNDARY_ERROR };
  }

  if (parsedTokens <= 0) {
    return {
      ok: false,
      action: "error",
      message: "Invalid smart boundary. The boundary must be a positive whole-number token count.",
    };
  }

  return { ok: true, action: "set", target: "boundary", tokens: parsedTokens, boundaryTokens: parsedTokens };
}

function parseIntervalArgument(rest: string): SmartBoundaryParseResult {
  const value = rest.trim();

  if (value.length === 0) {
    return { ok: true, action: "show" };
  }

  if (value.toLowerCase() === "reset") {
    return { ok: true, action: "reset", target: "interval" };
  }

  const parsedTokens = parseTokenValue(value);
  if (parsedTokens === undefined || parsedTokens <= 0) {
    return { ok: false, action: "error", message: INTERVAL_ERROR };
  }

  return { ok: true, action: "set", target: "interval", tokens: parsedTokens, intervalTokens: parsedTokens };
}

export const parseSmartBoundaryCommand = parseSmartBoundaryInput;
export const parseSmartBoundary = parseSmartBoundaryInput;

function parseTokenValue(value: string): number | undefined {
  if (INTEGER_TOKENS_PATTERN.test(value)) {
    return safeTokenNumber(BigInt(value));
  }

  const kMatch = K_TOKENS_PATTERN.exec(value);
  if (kMatch) {
    return safeTokenNumber(BigInt(kMatch[1]) * 1_000n);
  }

  return undefined;
}

function safeTokenNumber(value: bigint): number | undefined {
  if (value > MAX_SAFE_TOKEN_COUNT) {
    return undefined;
  }

  return Number(value);
}

export default parseSmartBoundaryInput;
