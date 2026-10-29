# AutonomousBusinessUnits/postiz: Postiz on Vercel

A public fork of [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app)
(AGPL-3.0). It is adapted to run on Vercel + Neon. The license and all upstream
notices are kept. The running app links to this repository on every page, as
AGPL-3.0 §13 requires (`apps/frontend/src/components/fork/source.link.tsx`;
override the URL with `SOURCE_CODE_URL`).

## Why
Upstream assumes long-lived processes, a disk and Redis. On Vercel:
- **Daemons** are always-on but take no inbound traffic and have no disk.
- **Functions/Services** take inbound HTTP but are bounded: 4.5 MB request bodies,
  800 s max duration (1800 s in the extended beta), and no disk.

So each piece goes to the Vercel product that fits it, and the few places that
assumed a disk, Redis or a reachable Temporal server become configurable.

## Layout on Vercel (one project, repo root; see `vercel.json`)
| Upstream piece | Vercel home |
|---|---|
| `apps/frontend` (Next.js) | Service `web`, Next.js framework |
| `apps/backend` (NestJS) | Service `api`, container (`Dockerfile.backend`), behind the same-origin rewrite `/api/*` |
| `apps/orchestrator` (Temporal worker) | Daemon `worker` (`Dockerfile.orchestrator`), 1 instance in iad1, 2 GiB |
| Postgres | Neon (pooled URL at runtime; the direct URL for `prisma db push` at deploy) |
| Uploads | Vercel Blob (`STORAGE_PROVIDER=vercel-blob`). The browser uploads straight to Blob, so files never cross the 4.5 MB limit |
| Redis | Upstash (`REDIS_URL`), **or** `KV_PROVIDER=postgres` (no Redis) |
| Temporal | Temporal Cloud (`TEMPORAL_ADDRESS/NAMESPACE/API_KEY`, `TEMPORAL_TLS=true`), **or** `TEMPORAL_BRIDGE=postgres` (spike only) |

## What changed (each change is marked `Fork:` in the code)
1. `upload/vercel.blob.storage.ts`, `upload.factory.ts`: a new `vercel-blob` storage provider.
2. `media.controller.ts`: `POST /media/blob-upload` mints a client token (auth via the
   org guard) and `POST /media/blob-complete` verifies the blob and saves the media row.
3. `react-shared-libraries/.../vercel.blob.uploader.ts`, `uppy.upload.ts`: an Uppy uploader
   for direct browser-to-Blob uploads (multipart above 8 MB).
4. `redis/pg.kv.ts`, `redis.service.ts`, `app.module.ts`: `KV_PROVIDER=postgres` stores
   get, set (EX/NX), del, rpush, lrange and expire in the `KvEntry` table. The throttler
   falls back to in-memory.
5. `temporal/bridge/*`, `temporal.module.ts`, `temporal.register.ts`, orchestrator
   `app.module.ts`: `TEMPORAL_BRIDGE=postgres`. The backend queues Temporal client calls in
   `TemporalBridgeCall`, and the Daemon runs a loopback Temporal dev server and executes
   them there. **Spike only:** dev-server state is lost when the Daemon restarts. Use
   Temporal Cloud in production.
6. `apps/backend/src/main.ts`: `BACKEND_STRIP_PREFIX=/api` for the same-origin rewrite.
7. `schema.prisma`: the `KvEntry` and `TemporalBridgeCall` models (additive).
8. `Dockerfile.backend`, `Dockerfile.orchestrator`, `var/vercel/worker.sh`, `vercel.json`, `FORK.md`.
9. The AGPL source link in the three frontend layouts.

## Deploy
1. Run `DATABASE_URL=<direct Neon URL> pnpm run prisma-db-push` once per schema change.
2. Set the project env: see `var/vercel/env.example`.
3. Run `vercel deploy --prod`. Daemons run only in production during the beta.

## Syncing upstream
```
git remote add upstream https://github.com/gitroomhq/postiz-app.git
git fetch upstream --tags
git checkout -b sync/vX.Y.Z vercel && git merge vX.Y.Z   # resolve conflicts in the files above
```
Then rebuild, run `prisma db push`, and smoke-test sign-in, a channel, a scheduled post and an upload.
Pin to release tags, not `main`. Base: **v2.25.3** (`a5affe62`, 2026-10-24).
