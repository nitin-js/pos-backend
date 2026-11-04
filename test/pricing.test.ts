import { describe, expect, it } from "vitest";
import { decimalToScaled, priceLine, recipeConsumption, scaledToDecimal } from "../src/money";
import { toBaseQuantity } from "../src/units";

describe("money and recipes", () => {
  it("converts rupees to paise", () => {
    expect(decimalToScaled("120.50", 2)).toBe(12050);
    expect(scaledToDecimal(12050, 2)).toBe("120.50");
  });

  it("prices exclusive GST on a line", () => {
    const line = priceLine({
      qtyMilli: 1000,
      unitPriceMinor: 10000,
      discountBps: 0,
      taxRateBps: 500,
      taxMode: "exclusive",
    });
    expect(line.taxMinor).toBe(500);
    expect(line.netMinor).toBe(10000);
  });

  it("prices inclusive GST without treating tax as profit", () => {
    const line = priceLine({
      qtyMilli: 1000,
      unitPriceMinor: 11800,
      discountBps: 0,
      taxRateBps: 1800,
      taxMode: "inclusive",
    });
    expect(line.taxMinor).toBe(1800);
    expect(line.netMinor).toBe(10000);
  });

  it("deducts 100 g of onion from a sandwich and 10 kg from 100 sandwiches", () => {
    const onionPerSandwich = toBaseQuantity("100", "g", "mg");
    expect(onionPerSandwich).toBe(100_000);
    expect(recipeConsumption(onionPerSandwich, 1000, 0)).toBe(100_000);
    expect(recipeConsumption(onionPerSandwich, 100_000, 0)).toBe(10_000_000);
    const opening = toBaseQuantity("100", "kg", "mg");
    expect(opening - recipeConsumption(onionPerSandwich, 1000, 0)).toBe(99_900_000);
    expect(opening - recipeConsumption(onionPerSandwich, 100_000, 0)).toBe(90_000_000);
  });

  it("adds wastage basis points once", () => {
    expect(recipeConsumption(100_000, 1000, 1000)).toBe(110_000);
  });
});
