// Fork (AutonomousBusinessUnits/postiz): runs inside the worker Daemon when
// TEMPORAL_BRIDGE=postgres. Claims queued client calls from
// "TemporalBridgeCall" and executes them against the Temporal server the
// Daemon can reach (TEMPORAL_ADDRESS, normally a local dev server).
import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Client, Connection } from '@temporalio/client';
import { defineSearchAttributeKey, TypedSearchAttributes } from '@temporalio/common';

const hydrate = (opts: any) => {
  const pairs = opts?.typedSearchAttributes?.__pairs;
  if (!pairs) return opts;
  return {
    ...opts,
    typedSearchAttributes: new TypedSearchAttributes(
      pairs.map((p: any) => ({
        key: defineSearchAttributeKey(p.name, p.type),
        value: p.value,
      }))
    ),
  };
};

@Injectable()
export class TemporalBridgeWorker implements OnModuleInit, OnModuleDestroy {
  private db = new PrismaClient();
  private client?: Client;
  private stop = false;

  async onModuleInit() {
    if (process.env.TEMPORAL_BRIDGE !== 'postgres') return;
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    });
    this.client = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    });
    Logger.log('Temporal bridge worker polling', 'TemporalBridge');
    this.loop();
  }

  onModuleDestroy() {
    this.stop = true;
  }

  private async loop() {
    let lastClean = 0;
    while (!this.stop) {
      try {
        const rows = await this.db.$queryRawUnsafe<any[]>(
          `UPDATE "TemporalBridgeCall" SET status = 'running', "updatedAt" = now()
           WHERE id IN (SELECT id FROM "TemporalBridgeCall" WHERE status = 'pending'
                        ORDER BY "createdAt" LIMIT 20 FOR UPDATE SKIP LOCKED)
           RETURNING id, op, args`
        );
        await Promise.all(rows.map((r) => this.run(r)));
        if (Date.now() - lastClean > 600_000) {
          lastClean = Date.now();
          await this.db.$executeRawUnsafe(
            `DELETE FROM "TemporalBridgeCall" WHERE status IN ('done','error') AND "updatedAt" < now() - interval '1 hour'`
          );
        }
        if (!rows.length) await new Promise((r) => setTimeout(r, 500));
      } catch (e) {
        Logger.error(`bridge loop: ${(e as Error).message}`, 'TemporalBridge');
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  private async run(row: { id: string; op: string; args: any }) {
    const w = this.client!.workflow;
    const a = row.args || {};
    try {
      let result: any = null;
      switch (row.op) {
        case 'start':
          await w.start(a.name, hydrate(a.opts));
          break;
        case 'signalWithStart':
          await w.signalWithStart(a.name, hydrate(a.opts));
          break;
        case 'list': {
          result = [];
          for await (const x of w.list({ query: a.query })) {
            result.push({ workflowId: x.workflowId, runId: x.runId, status: { name: x.status.name } });
          }
          break;
        }
        case 'describe': {
          const d = await w.getHandle(a.workflowId).describe();
          result = { workflowId: d.workflowId, runId: d.runId, status: { name: d.status.name } };
          break;
        }
        case 'terminate':
          await w.getHandle(a.workflowId).terminate(a.reason);
          break;
        case 'signal':
          await w.getHandle(a.workflowId).signal(a.signal, ...(a.signalArgs || []));
          break;
        case 'result':
          result = await w.getHandle(a.workflowId).result();
          break;
        default:
          throw new Error(`unknown op ${row.op}`);
      }
      await this.db.temporalBridgeCall.update({
        where: { id: row.id },
        data: { status: 'done', result: JSON.parse(JSON.stringify(result ?? null)) },
      });
    } catch (e) {
      await this.db.temporalBridgeCall.update({
        where: { id: row.id },
        data: { status: 'error', error: String((e as Error).message).slice(0, 2000) },
      });
    }
  }
}
