import { createHash } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Timestamp,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** All data is server-owned. Clients never select collection names or document paths. */
export interface Store {
  get<T>(collection: string, id: string): Promise<T | null>;
  set<T>(
    collection: string,
    id: string,
    value: T,
    expiresAt?: number,
  ): Promise<void>;
  create<T>(
    collection: string,
    id: string,
    value: T,
    expiresAt?: number,
  ): Promise<boolean>;
  compareAndSet<T>(
    collection: string,
    id: string,
    value: T,
    expectedVersion: number,
    expiresAt?: number,
  ): Promise<boolean>;
  delete(collection: string, id: string): Promise<void>;
  consume<T>(collection: string, id: string): Promise<T | null>;
  list<T>(collection: string, owner: string, limit?: number): Promise<T[]>;
  rateLimit(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult>;
  close(): Promise<void>;
}

type Clock = () => number;
type Envelope = {
  payload: string;
  owner: string;
  createdAt: number;
  expiresAt: number | null;
};
const MAX_RECORD_BYTES = 900_000;
const validCollection = /^[a-z][a-z0-9_]{0,47}$/;
const validId = /^[A-Za-z0-9_.:@-]{1,256}$/;
function keyCheck(collection: string, id?: string) {
  if (!validCollection.test(collection))
    throw new Error("Invalid store collection.");
  if (id !== undefined && (!validId.test(id) || id === "." || id === ".."))
    throw new Error("Invalid store document ID.");
}
function envelope<T>(
  value: T,
  expiresAt: number | undefined,
  now: number,
): Envelope {
  const payload = JSON.stringify(value);
  if (payload === undefined || Buffer.byteLength(payload) > MAX_RECORD_BYTES)
    throw new Error("Store record is not valid bounded JSON.");
  if (
    expiresAt !== undefined &&
    (!Number.isSafeInteger(expiresAt) || expiresAt <= 0)
  )
    throw new Error("Invalid store expiry.");
  const source =
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const owner = typeof source.owner === "string" ? source.owner : "";
  if (owner.length > 256) throw new Error("Invalid store owner.");
  return {
    payload,
    owner,
    createdAt:
      typeof source.createdAt === "number" &&
      Number.isSafeInteger(source.createdAt)
        ? source.createdAt
        : now,
    expiresAt: expiresAt ?? null,
  };
}
function live(
  record: Envelope | undefined | null,
  now: number,
): record is Envelope {
  return !!record && (record.expiresAt === null || record.expiresAt > now);
}
function listCheck(collection: string, owner: string, limit: number) {
  keyCheck(collection);
  if (typeof owner !== "string" || !owner || owner.length > 256)
    throw new Error("Invalid store owner.");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("List limit must be between 1 and 100.");
}
function rateCheck(key: string, limit: number, windowMs: number) {
  if (typeof key !== "string" || !key || key.length > 1024)
    throw new Error("Invalid rate limit key.");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_000)
    throw new Error("Invalid rate limit.");
  if (!Number.isSafeInteger(windowMs) || windowMs < 1 || windowMs > 86_400_000)
    throw new Error("Invalid rate window.");
  return createHash("sha256").update(key).digest("hex");
}
function versionCheck<T>(value: T, expectedVersion: number) {
  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0 ||
    expectedVersion >= Number.MAX_SAFE_INTEGER
  )
    throw new Error("Invalid expected version.");
  if (
    !value ||
    typeof value !== "object" ||
    (value as Record<string, unknown>).version !== expectedVersion + 1
  )
    throw new Error("New record version must increment the expected version.");
}
function recordVersion(
  record: Envelope | undefined | null,
  now: number,
): number {
  if (!live(record, now)) return 0;
  const value = JSON.parse(record.payload) as unknown;
  const version =
    value && typeof value === "object"
      ? (value as Record<string, unknown>).version
      : undefined;
  return typeof version === "number" &&
    Number.isSafeInteger(version) &&
    version >= 0
    ? version
    : 0;
}
function limitResult(
  count: number,
  limit: number,
  resetsAt: number,
  now: number,
): RateLimitResult {
  return {
    allowed: count <= limit,
    retryAfterSeconds:
      count <= limit ? 0 : Math.max(1, Math.ceil((resetsAt - now) / 1000)),
  };
}

/** Persistent local development store. Production config requires Firestore. */
export class SQLiteStore implements Store {
  private readonly db: DatabaseSync;
  private operations = 0;
  constructor(
    path: string,
    private readonly clock: Clock = Date.now,
  ) {
    if (!path || (path !== ":memory:" && path.includes("\0")))
      throw new Error("Invalid SQLite path.");
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      closeSync(openSync(path, "a", 0o600));
      chmodSync(path, 0o600);
    }
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (
        collection TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
        owner TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS records_owner_created ON records(collection, owner, created_at DESC);
      CREATE INDEX IF NOT EXISTS records_expiry ON records(expires_at);
      CREATE TABLE IF NOT EXISTS rate_limits (id TEXT PRIMARY KEY, count INTEGER NOT NULL, resets_at INTEGER NOT NULL);`);
  }
  private row(collection: string, id: string): Envelope | null {
    return (
      (this.db
        .prepare(
          "SELECT payload, owner, created_at AS createdAt, expires_at AS expiresAt FROM records WHERE collection = ? AND id = ?",
        )
        .get(collection, id) as Envelope | undefined) ?? null
    );
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private cleanup() {
    if (++this.operations % 100 !== 0) return;
    const now = this.clock();
    this.db
      .prepare(
        "DELETE FROM records WHERE rowid IN (SELECT rowid FROM records WHERE expires_at <= ? LIMIT 1000)",
      )
      .run(now);
    this.db
      .prepare(
        "DELETE FROM rate_limits WHERE id IN (SELECT id FROM rate_limits WHERE resets_at <= ? LIMIT 1000)",
      )
      .run(now);
  }
  async get<T>(collection: string, id: string): Promise<T | null> {
    keyCheck(collection, id);
    this.cleanup();
    const record = this.row(collection, id);
    if (!live(record, this.clock())) return null;
    return JSON.parse(record.payload) as T;
  }
  async set<T>(
    collection: string,
    id: string,
    value: T,
    expiresAt?: number,
  ): Promise<void> {
    keyCheck(collection, id);
    const record = envelope(value, expiresAt, this.clock());
    this.cleanup();
    this.db
      .prepare(
        "INSERT INTO records (collection,id,payload,owner,created_at,expires_at) VALUES (?,?,?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET payload=excluded.payload,owner=excluded.owner,created_at=excluded.created_at,expires_at=excluded.expires_at",
      )
      .run(
        collection,
        id,
        record.payload,
        record.owner,
        record.createdAt,
        record.expiresAt,
      );
  }
  async create<T>(
    collection: string,
    id: string,
    value: T,
    expiresAt?: number,
  ): Promise<boolean> {
    keyCheck(collection, id);
    const record = envelope(value, expiresAt, this.clock());
    this.cleanup();
    return this.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM records WHERE collection=? AND id=? AND expires_at <= ?",
        )
        .run(collection, id, this.clock());
      const result = this.db
        .prepare(
          "INSERT OR IGNORE INTO records (collection,id,payload,owner,created_at,expires_at) VALUES (?,?,?,?,?,?)",
        )
        .run(
          collection,
          id,
          record.payload,
          record.owner,
          record.createdAt,
          record.expiresAt,
        );
      return Number(result.changes) === 1;
    });
  }
  async compareAndSet<T>(
    collection: string,
    id: string,
    value: T,
    expectedVersion: number,
    expiresAt?: number,
  ): Promise<boolean> {
    keyCheck(collection, id);
    versionCheck(value, expectedVersion);
    const record = envelope(value, expiresAt, this.clock());
    return this.transaction(() => {
      if (
        recordVersion(this.row(collection, id), this.clock()) !==
        expectedVersion
      )
        return false;
      this.db
        .prepare(
          "INSERT INTO records (collection,id,payload,owner,created_at,expires_at) VALUES (?,?,?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET payload=excluded.payload,owner=excluded.owner,created_at=excluded.created_at,expires_at=excluded.expires_at",
        )
        .run(
          collection,
          id,
          record.payload,
          record.owner,
          record.createdAt,
          record.expiresAt,
        );
      return true;
    });
  }
  async delete(collection: string, id: string): Promise<void> {
    keyCheck(collection, id);
    this.db
      .prepare("DELETE FROM records WHERE collection=? AND id=?")
      .run(collection, id);
  }
  async consume<T>(collection: string, id: string): Promise<T | null> {
    keyCheck(collection, id);
    return this.transaction(() => {
      const record = this.row(collection, id);
      this.db
        .prepare("DELETE FROM records WHERE collection=? AND id=?")
        .run(collection, id);
      return live(record, this.clock())
        ? (JSON.parse(record.payload) as T)
        : null;
    });
  }
  async list<T>(collection: string, owner: string, limit = 50): Promise<T[]> {
    listCheck(collection, owner, limit);
    this.cleanup();
    const rows = this.db
      .prepare(
        "SELECT payload FROM records WHERE collection=? AND owner=? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC, id DESC LIMIT ?",
      )
      .all(collection, owner, this.clock(), limit) as Array<{
      payload: string;
    }>;
    return rows.map((record) => JSON.parse(record.payload) as T);
  }
  async rateLimit(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    const id = rateCheck(key, limit, windowMs);
    this.cleanup();
    return this.transaction(() => {
      const now = this.clock();
      const prior = this.db
        .prepare(
          "SELECT count, resets_at AS resetsAt FROM rate_limits WHERE id=?",
        )
        .get(id) as { count: number; resetsAt: number } | undefined;
      const count =
        prior && prior.resetsAt > now
          ? Math.min(prior.count + 1, limit + 1)
          : 1;
      const resetsAt =
        prior && prior.resetsAt > now ? prior.resetsAt : now + windowMs;
      this.db
        .prepare(
          "INSERT INTO rate_limits (id,count,resets_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET count=excluded.count,resets_at=excluded.resets_at",
        )
        .run(id, count, resetsAt);
      return limitResult(count, limit, resetsAt, now);
    });
  }
  async close() {
    this.db.close();
  }
}

/** Unit-test store only. Do not select this adapter in production configuration. */
export class MemoryStore implements Store {
  private readonly records = new Map<string, Envelope>();
  private readonly counters = new Map<
    string,
    { count: number; resetsAt: number }
  >();
  constructor(private readonly clock: Clock = Date.now) {}
  private key(collection: string, id: string) {
    keyCheck(collection, id);
    return `${collection}/${id}`;
  }
  async get<T>(collection: string, id: string): Promise<T | null> {
    const record = this.records.get(this.key(collection, id));
    return live(record, this.clock())
      ? (JSON.parse(record.payload) as T)
      : null;
  }
  async set<T>(collection: string, id: string, value: T, expiresAt?: number) {
    this.records.set(
      this.key(collection, id),
      envelope(value, expiresAt, this.clock()),
    );
  }
  async create<T>(
    collection: string,
    id: string,
    value: T,
    expiresAt?: number,
  ) {
    const key = this.key(collection, id);
    if (live(this.records.get(key), this.clock())) return false;
    this.records.set(key, envelope(value, expiresAt, this.clock()));
    return true;
  }
  async compareAndSet<T>(
    collection: string,
    id: string,
    value: T,
    expectedVersion: number,
    expiresAt?: number,
  ) {
    const key = this.key(collection, id);
    versionCheck(value, expectedVersion);
    const record = envelope(value, expiresAt, this.clock());
    if (recordVersion(this.records.get(key), this.clock()) !== expectedVersion)
      return false;
    this.records.set(key, record);
    return true;
  }
  async delete(collection: string, id: string) {
    this.records.delete(this.key(collection, id));
  }
  async consume<T>(collection: string, id: string): Promise<T | null> {
    const key = this.key(collection, id);
    const record = this.records.get(key);
    this.records.delete(key);
    return live(record, this.clock())
      ? (JSON.parse(record.payload) as T)
      : null;
  }
  async list<T>(collection: string, owner: string, limit = 50): Promise<T[]> {
    listCheck(collection, owner, limit);
    return [...this.records.entries()]
      .filter(
        ([key, r]) =>
          key.startsWith(`${collection}/`) &&
          r.owner === owner &&
          live(r, this.clock()),
      )
      .sort(
        (a, b) => b[1].createdAt - a[1].createdAt || b[0].localeCompare(a[0]),
      )
      .slice(0, limit)
      .map(([, r]) => JSON.parse(r.payload) as T);
  }
  async rateLimit(key: string, limit: number, windowMs: number) {
    const id = rateCheck(key, limit, windowMs),
      now = this.clock(),
      prior = this.counters.get(id);
    const record =
      prior && prior.resetsAt > now
        ? {
            count: Math.min(prior.count + 1, limit + 1),
            resetsAt: prior.resetsAt,
          }
        : { count: 1, resetsAt: now + windowMs };
    this.counters.set(id, record);
    return limitResult(record.count, limit, record.resetsAt, now);
  }
  async close() {
    this.records.clear();
    this.counters.clear();
  }
}

/** Firestore transactions make nonce consumption, idempotency and limits safe across instances. */
export class FirestoreStore implements Store {
  constructor(
    private readonly db: Firestore,
    private readonly clock: Clock = Date.now,
  ) {}
  private ref(collection: string, id: string) {
    keyCheck(collection, id);
    return this.db.collection(`hoplane_${collection}`).doc(id);
  }
  private persisted(record: Envelope) {
    return {
      ...record,
      ...(record.expiresAt === null
        ? {}
        : { ttl: Timestamp.fromMillis(record.expiresAt) }),
    };
  }
  async get<T>(collection: string, id: string): Promise<T | null> {
    const snap = await this.ref(collection, id).get();
    const record = snap.data() as Envelope | undefined;
    return live(record, this.clock())
      ? (JSON.parse(record.payload) as T)
      : null;
  }
  async set<T>(collection: string, id: string, value: T, expiresAt?: number) {
    const ref = this.ref(collection, id),
      record = envelope(value, expiresAt, this.clock());
    await ref.set(this.persisted(record));
  }
  async create<T>(
    collection: string,
    id: string,
    value: T,
    expiresAt?: number,
  ): Promise<boolean> {
    const ref = this.ref(collection, id),
      record = envelope(value, expiresAt, this.clock());
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (live(snap.data() as Envelope | undefined, this.clock())) return false;
      tx.set(ref, this.persisted(record));
      return true;
    });
  }
  async compareAndSet<T>(
    collection: string,
    id: string,
    value: T,
    expectedVersion: number,
    expiresAt?: number,
  ): Promise<boolean> {
    const ref = this.ref(collection, id);
    versionCheck(value, expectedVersion);
    const record = envelope(value, expiresAt, this.clock());
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (
        recordVersion(snap.data() as Envelope | undefined, this.clock()) !==
        expectedVersion
      )
        return false;
      tx.set(ref, this.persisted(record));
      return true;
    });
  }
  async delete(collection: string, id: string) {
    await this.ref(collection, id).delete();
  }
  async consume<T>(collection: string, id: string): Promise<T | null> {
    const ref = this.ref(collection, id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref),
        record = snap.data() as Envelope | undefined;
      if (snap.exists) tx.delete(ref);
      return live(record, this.clock())
        ? (JSON.parse(record.payload) as T)
        : null;
    });
  }
  async list<T>(collection: string, owner: string, limit = 50): Promise<T[]> {
    listCheck(collection, owner, limit);
    const query = this.db
      .collection(`hoplane_${collection}`)
      .where("owner", "==", owner)
      .orderBy("createdAt", "desc");
    const results: T[] = [];
    const pageSize = Math.max(limit, 25);
    let cursor: QueryDocumentSnapshot | undefined;
    // TTL deletion is asynchronous. Expired rows must not occupy the caller's
    // limit, otherwise a recent expired record can hide a live transfer entirely.
    while (results.length < limit) {
      const page = await (cursor ? query.startAfter(cursor) : query)
        .limit(pageSize)
        .get();
      for (const doc of page.docs) {
        const record = doc.data() as Envelope;
        if (live(record, this.clock()))
          results.push(JSON.parse(record.payload) as T);
        if (results.length === limit) break;
      }
      if (page.size < pageSize) break;
      cursor = page.docs.at(-1);
    }
    return results;
  }
  async rateLimit(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    const id = rateCheck(key, limit, windowMs),
      ref = this.ref("rate_limits", id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref),
        prior = snap.data() as { count: number; resetsAt: number } | undefined,
        now = this.clock();
      const count =
          prior && prior.resetsAt > now
            ? Math.min(prior.count + 1, limit + 1)
            : 1,
        resetsAt =
          prior && prior.resetsAt > now ? prior.resetsAt : now + windowMs;
      tx.set(ref, { count, resetsAt, ttl: Timestamp.fromMillis(resetsAt) });
      return limitResult(count, limit, resetsAt, now);
    });
  }
  async close() {
    await this.db.terminate();
  }
}
