import { Long } from "mongodb";

export function long(value: number): Long {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Value is not a safe integer: ${value}`);
  }
  return Long.fromNumber(value);
}

export function num(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Half away from zero. */
export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error("Denominator must be positive");
  }
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = abs / denominator;
  const remainder = abs % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

export function decimalToScaled(value: string, scale: number): number {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || scale < 0) {
    throw new Error(`Invalid decimal "${value}"`);
  }
  const negative = match[1] === "-";
  const whole = BigInt(match[2]);
  const digits = match[3] ?? "";
  const kept = digits.slice(0, scale);
  const extra = digits.slice(scale);
  let fraction = BigInt(kept.padEnd(scale, "0") || "0");
  if (extra.length > 0 && extra[0] >= "5") {
    fraction += 1n;
  }
  const factor = 10n ** BigInt(scale);
  if (fraction >= factor) {
    fraction -= factor;
    const scaled = (whole + 1n) * factor + fraction;
    const signed = negative ? -scaled : scaled;
    return Number(signed);
  }
  const scaled = whole * factor + fraction;
  const signed = negative ? -scaled : scaled;
  if (!Number.isSafeInteger(Number(signed))) {
    throw new Error(`Decimal is too large "${value}"`);
  }
  return Number(signed);
}

export function scaledToDecimal(value: number, scale: number): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const factor = 10 ** scale;
  const whole = Math.floor(abs / factor);
  const fraction = String(abs % factor).padStart(scale, "0");
  if (scale === 0) return `${negative ? "-" : ""}${whole}`;
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function recipeConsumption(qtyBase: number, qtyMilli: number, wastageBps: number): number {
  const numerator = BigInt(qtyBase) * BigInt(qtyMilli) * BigInt(10000 + wastageBps);
  const denominator = 1000n * 10000n;
  return Number(roundDiv(numerator, denominator));
}

export interface PricedLine {
  qtyMilli: number;
  unitPriceMinor: number;
  discountMinor: number;
  taxMinor: number;
  extendedMinor: number;
  netMinor: number;
}

export function priceLine(input: {
  qtyMilli: number;
  unitPriceMinor: number;
  discountBps: number;
  taxRateBps: number;
  taxMode: "inclusive" | "exclusive";
}): PricedLine {
  const extended = Number(roundDiv(BigInt(input.unitPriceMinor) * BigInt(input.qtyMilli), 1000n));
  const discount = Number(roundDiv(BigInt(extended) * BigInt(input.discountBps), 10000n));
  const afterDiscount = extended - discount;
  if (input.taxMode === "exclusive") {
    const tax = Number(roundDiv(BigInt(afterDiscount) * BigInt(input.taxRateBps), 10000n));
    return {
      qtyMilli: input.qtyMilli,
      unitPriceMinor: input.unitPriceMinor,
      discountMinor: discount,
      taxMinor: tax,
      extendedMinor: extended,
      netMinor: afterDiscount,
    };
  }
  const taxable = Number(roundDiv(BigInt(afterDiscount) * 10000n, BigInt(10000 + input.taxRateBps)));
  const tax = afterDiscount - taxable;
  return {
    qtyMilli: input.qtyMilli,
    unitPriceMinor: input.unitPriceMinor,
    discountMinor: discount,
    taxMinor: tax,
    extendedMinor: extended,
    netMinor: taxable,
  };
}
