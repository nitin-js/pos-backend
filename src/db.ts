import { Collection, Db, Document, MongoClient } from "mongodb";
import { config } from "./config";

let client: MongoClient | undefined;
let database: Db | undefined;
let replicaSet = false;

export async function connectDb(uri = config.mongoUri, name = config.mongoDb): Promise<Db> {
  if (database && database.databaseName === name) return database;
  client = new MongoClient(uri);
  await client.connect();
  database = client.db(name);
  const hello = await database.command({ hello: 1 });
  replicaSet = Boolean(hello.setName);
  return database;
}

export function getDb(): Db {
  if (!database) throw new Error("Database is not connected");
  return database;
}

export function col<T extends Document = Document>(name: string): Collection<T> {
  return getDb().collection<T>(name);
}

export async function closeDb(): Promise<void> {
  await client?.close();
  client = undefined;
  database = undefined;
}

export function hasReplicaSet(): boolean {
  return replicaSet;
}
