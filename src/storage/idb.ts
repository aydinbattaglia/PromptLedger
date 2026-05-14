import type { GenerationRecord, RecordFilters, UsageStats } from '../types/index.js';

const DB_NAME = 'promptledger';
const DB_VERSION = 1;
const STORE = 'generations';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('tool', 'tool', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('project_tag', 'project_tag', { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function runTx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveRecord(record: GenerationRecord): Promise<void> {
  const db = await openDB();
  await runTx(db, 'readwrite', (store) => store.put(record));
  db.close();
}

export async function getRecords(filters: RecordFilters = {}): Promise<GenerationRecord[]> {
  const db = await openDB();

  const records = await new Promise<GenerationRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);

    let req: IDBRequest<IDBCursorWithValue | null>;

    if (filters.from !== undefined || filters.to !== undefined) {
      const index = store.index('timestamp');
      const lower = filters.from ?? '';
      const upper = filters.to ?? '￿';
      req = index.openCursor(IDBKeyRange.bound(lower, upper));
    } else {
      req = store.openCursor();
    }

    const results: GenerationRecord[] = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        results.push(cursor.value as GenerationRecord);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });

  db.close();

  let out = records;
  if (filters.tool) out = out.filter((r) => r.tool === filters.tool);
  if (filters.project_tag) out = out.filter((r) => r.project_tag === filters.project_tag);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    out = out.filter((r) => r.prompt?.toLowerCase().includes(q));
  }

  out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const offset = filters.offset ?? 0;
  return filters.limit ? out.slice(offset, offset + filters.limit) : out.slice(offset);
}

export async function deleteRecord(id: string): Promise<void> {
  const db = await openDB();
  await runTx(db, 'readwrite', (store) => store.delete(id));
  db.close();
}

export async function clearAll(): Promise<void> {
  const db = await openDB();
  await runTx(db, 'readwrite', (store) => store.clear());
  db.close();
}

export async function getStats(): Promise<UsageStats> {
  const now = new Date();

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);

  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const records = await getRecords({ from: monthStart.toISOString() });

  const stats: UsageStats = {
    credits_today: 0,
    credits_week: 0,
    cost_month_usd: 0,
    by_tool: {},
  };

  for (const r of records) {
    const ts = new Date(r.timestamp);
    const credits = r.credits_used ?? 0;
    const cost = r.cost_usd ?? 0;

    if (ts >= todayStart) stats.credits_today += credits;
    if (ts >= weekStart) stats.credits_week += credits;
    stats.cost_month_usd += cost;

    if (!(r.tool in stats.by_tool)) {
      stats.by_tool[r.tool] = { credits: 0, cost_usd: 0 };
    }
    const toolStats = stats.by_tool[r.tool]!;
    toolStats.credits += credits;
    toolStats.cost_usd += cost;
  }

  return stats;
}
