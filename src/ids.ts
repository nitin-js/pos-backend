import { ObjectId } from "mongodb";
import { HttpError } from "./http";

export function id(): ObjectId {
  return new ObjectId();
}

export function idText(value: unknown): string {
  if (value instanceof ObjectId) return value.toHexString();
  return String(value ?? "");
}

export function asId(value: unknown): ObjectId {
  if (value instanceof ObjectId) return value;
  if (typeof value === "string" && /^[a-f0-9]{24}$/i.test(value)) return new ObjectId(value);
  throw new HttpError(400, "validation_failed", "Invalid id.");
}
