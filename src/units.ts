const MASS: Record<string, number> = {
  mg: 1,
  g: 1000,
  kg: 1_000_000,
};

const VOLUME: Record<string, number> = {
  ml: 1,
  l: 1000,
};

export function toBaseQuantity(quantity: string, unit: string, baseUnit: "mg" | "ml" | "milli_each"): number {
  const scaled = decimalToScaledLocal(quantity, 3);
  const normalized = unit.trim().toLowerCase();
  if (baseUnit === "mg") {
    const factor = MASS[normalized];
    if (!factor) throw new Error(`Unit ${unit} is not a mass unit`);
    return Number(round(BigInt(scaled) * BigInt(factor), 1000n));
  }
  if (baseUnit === "ml") {
    const factor = VOLUME[normalized];
    if (!factor) throw new Error(`Unit ${unit} is not a volume unit`);
    return Number(round(BigInt(scaled) * BigInt(factor), 1000n));
  }
  const each = normalized === "milli_each" ? 1 : 1000;
  if (!["piece", "pieces", "slice", "slices", "each", "unit", "milli_each"].includes(normalized)) {
    throw new Error(`Unit ${unit} is not a count unit`);
  }
  return Number(round(BigInt(scaled) * BigInt(each), 1000n));
}

export function fromBaseQuantity(qtyBase: number, baseUnit: "mg" | "ml" | "milli_each", displayUnit: string): string {
  const unit = displayUnit.trim().toLowerCase();
  if (baseUnit === "mg") {
    const factor = MASS[unit] ?? 1;
    return formatRatio(qtyBase, factor);
  }
  if (baseUnit === "ml") {
    const factor = VOLUME[unit] ?? 1;
    return formatRatio(qtyBase, factor);
  }
  const factor = unit === "milli_each" ? 1 : 1000;
  return formatRatio(qtyBase, factor);
}

function formatRatio(qtyBase: number, factor: number): string {
  const negative = qtyBase < 0;
  const abs = Math.abs(qtyBase);
  const whole = Math.floor(abs / factor);
  const remainder = abs % factor;
  if (remainder === 0) return `${negative ? "-" : ""}${whole}`;
  const digits = String(remainder).padStart(String(factor).length - 1, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}.${digits}`;
}

function decimalToScaledLocal(value: string, scale: number): number {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid quantity "${value}"`);
  const sign = match[1] === "-" ? -1 : 1;
  const whole = Number(match[2]);
  const fraction = (match[3] ?? "").padEnd(scale, "0").slice(0, scale);
  return sign * (whole * 10 ** scale + Number(fraction || 0));
}

function round(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = abs / denominator;
  const remainder = abs % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}
