// Fork (AutonomousBusinessUnits/postiz): the subset of ioredis Postiz uses,
// on Postgres (table "KvEntry"), for deployments without Redis.
import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | undefined;
const db = () => (prisma ??= new PrismaClient());
const LIVE = `("expiresAt" IS NULL OR "expiresAt" > now())`;

export class PgKv {
  async get(key: string): Promise<string | null> {
    const rows = await db().$queryRawUnsafe<{ value: string | null }[]>(
      `SELECT value FROM "KvEntry" WHERE key = $1 AND ${LIVE}`,
      key
    );
    return rows[0]?.value ?? null;
  }

  // set(key, value), set(key, value, 'EX', secs), set(key, value, 'EX', secs, 'NX')
  async set(key: string, value: any, ...args: any[]): Promise<'OK' | null> {
    const upper = args.map((a) => (typeof a === 'string' ? a.toUpperCase() : a));
    const exAt = upper.indexOf('EX');
    const pxAt = upper.indexOf('PX');
    const ms =
      exAt >= 0 ? Number(args[exAt + 1]) * 1000 : pxAt >= 0 ? Number(args[pxAt + 1]) : null;
    const nx = upper.includes('NX');
    const expires = ms ? new Date(Date.now() + ms) : null;
    const n = await db().$executeRawUnsafe(
      `INSERT INTO "KvEntry" (key, value, list, "expiresAt") VALUES ($1, $2, '{}', $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, list = '{}', "expiresAt" = EXCLUDED."expiresAt"
       ${nx ? `WHERE "KvEntry"."expiresAt" IS NOT NULL AND "KvEntry"."expiresAt" <= now()` : ''}`,
      key,
      String(value),
      expires
    );
    return n > 0 ? 'OK' : null;
  }

  async del(...keys: string[]): Promise<number> {
    const flat = keys.flat();
    if (!flat.length) return 0;
    return db().$executeRawUnsafe(`DELETE FROM "KvEntry" WHERE key = ANY($1::text[])`, flat);
  }

  async rpush(key: string, ...values: any[]): Promise<number> {
    const vals = values.flat().map(String);
    const rows = await db().$queryRawUnsafe<{ n: number }[]>(
      `INSERT INTO "KvEntry" (key, value, list, "expiresAt") VALUES ($1, NULL, $2::text[], NULL)
       ON CONFLICT (key) DO UPDATE SET
         list = CASE WHEN "KvEntry"."expiresAt" IS NOT NULL AND "KvEntry"."expiresAt" <= now()
                     THEN EXCLUDED.list ELSE "KvEntry".list || EXCLUDED.list END,
         "expiresAt" = CASE WHEN "KvEntry"."expiresAt" IS NOT NULL AND "KvEntry"."expiresAt" <= now()
                     THEN NULL ELSE "KvEntry"."expiresAt" END
       RETURNING cardinality(list)::int AS n`,
      key,
      vals
    );
    return rows[0]?.n ?? 0;
  }

  async lrange(key: string, start: number, end: number): Promise<string[]> {
    const rows = await db().$queryRawUnsafe<{ list: string[] }[]>(
      `SELECT list FROM "KvEntry" WHERE key = $1 AND ${LIVE}`,
      key
    );
    const list = rows[0]?.list ?? [];
    const len = list.length;
    const s = start < 0 ? Math.max(len + start, 0) : start;
    const e = end < 0 ? len + end : Math.min(end, len - 1);
    return s > e ? [] : list.slice(s, e + 1);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return db().$executeRawUnsafe(
      `UPDATE "KvEntry" SET "expiresAt" = now() + make_interval(secs => $2) WHERE key = $1 AND ${LIVE}`,
      key,
      Number(seconds)
    );
  }
}
