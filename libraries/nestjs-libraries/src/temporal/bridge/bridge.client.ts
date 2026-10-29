// Fork (AutonomousBusinessUnits/postiz): TEMPORAL_BRIDGE=postgres.
// Stand-in for nestjs-temporal-core's TemporalService on the backend when the
// Temporal server is reachable only from the worker Daemon (e.g. a dev server
// inside the Daemon; Vercel Daemons take no inbound traffic). Calls are queued
// in "TemporalBridgeCall" and executed by bridge.worker.ts in the Daemon.
// With Temporal Cloud, leave TEMPORAL_BRIDGE unset and none of this runs.
import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | undefined;
const db = () => (prisma ??= new PrismaClient());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// TypedSearchAttributes -> plain pairs (re-hydrated in the Daemon)
const plain = (opts: any) => {
  if (!opts?.typedSearchAttributes) return opts;
  const pairs = opts.typedSearchAttributes
    .getAll()
    .map((p: any) => ({ name: p.key.name, type: p.key.type, value: p.value }));
  return { ...opts, typedSearchAttributes: { __pairs: pairs } };
};

async function call(op: string, args: any, wait = true, timeoutMs = 15000) {
  const row = await db().temporalBridgeCall.create({
    data: { op, args: JSON.parse(JSON.stringify(args ?? null)) },
  });
  if (!wait) return { workflowId: args?.opts?.workflowId };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(250);
    const r = await db().temporalBridgeCall.findUnique({ where: { id: row.id } });
    if (r?.status === 'done') return r.result as any;
    if (r?.status === 'error') throw new Error(r.error || 'bridge call failed');
  }
  throw new Error(`temporal bridge timeout (${op})`);
}

const handle = (workflowId: string) => ({
  workflowId,
  describe: () => call('describe', { workflowId }),
  terminate: (reason?: string) => call('terminate', { workflowId, reason }),
  result: () => call('result', { workflowId }, true, 60000),
  signal: (signal: string, ...signalArgs: any[]) =>
    call('signal', { workflowId, signal, signalArgs }),
});

const raw = {
  workflow: {
    // fire-and-forget: the workflow id is chosen by the caller
    start: (name: string, opts: any) =>
      call('start', { name, opts: plain(opts) }, false).then(() =>
        handle(opts?.workflowId)
      ),
    signalWithStart: (name: string, opts: any) =>
      call('signalWithStart', { name, opts: plain(opts) }, false).then(() =>
        handle(opts?.workflowId)
      ),
    list: (opts: { query?: string }) => {
      const p = call('list', opts) as Promise<any[]>;
      return {
        async *[Symbol.asyncIterator]() {
          for (const item of await p) yield item;
        },
      };
    },
    getHandle: (workflowId: string) => handle(workflowId),
  },
};

export class TemporalBridgeService {
  client = {
    getRawClient: () => raw,
    getWorkflowHandle: async (workflowId: string) => handle(workflowId),
  };
  terminateWorkflow(workflowId: string, reason?: string) {
    return call('terminate', { workflowId, reason });
  }
}
