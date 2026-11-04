import { describe, expect, it } from "vitest";
import { assertLocalDatabase } from "../src/local-db";

describe("localhost seed guard", () => {
  it("allows loopback MongoDB URLs outside production", () => {
    expect(() => assertLocalDatabase("mongodb://localhost:27017", "development")).not.toThrow();
    expect(() => assertLocalDatabase("mongodb://127.0.0.1:27017/pos-db", "development")).not.toThrow();
    expect(() => assertLocalDatabase("mongodb://[::1]:27017", "test")).not.toThrow();
  });

  it("refuses remote databases and production", () => {
    expect(() => assertLocalDatabase("mongodb://db.example.com:27017", "development")).toThrow(/localhost/);
    expect(() => assertLocalDatabase("mongodb+srv://cluster.example.mongodb.net", "development")).toThrow(/localhost/);
    expect(() => assertLocalDatabase("mongodb://localhost:27017", "production")).toThrow(/production/);
  });
});
