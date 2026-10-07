import type { ReturnType } from "@stride/shared";

export type ReturnRecord = {
  rma: string;
  orderId: string;
  itemId: string;
  type: ReturnType;
  reason: string;
  exchangeSize: number | null;
  createdAt: string;
};

/** In-memory return store (POC). RMA numbers are sequential so tests are deterministic. */
export class ReturnStore {
  private readonly records = new Map<string, ReturnRecord>();
  private next = 100001;

  has(itemId: string): boolean {
    return this.records.has(itemId);
  }

  create(record: Omit<ReturnRecord, "rma">): ReturnRecord {
    const saved = { ...record, rma: `RMA-${this.next++}` };
    this.records.set(record.itemId, saved);
    return saved;
  }
}
