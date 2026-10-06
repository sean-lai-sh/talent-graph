/**
 * An in-memory stand-in for a Convex deployment, enough to run the real
 * `convex/evidence.ts` handlers (SEA-81): a table store with the query
 * surface they use, one lock so each query and mutation is atomic as in
 * Convex, and `runQuery` / `runMutation` / `runAction` dispatching to the
 * real handlers by function name. Node-runtime actions (`evidenceNode`) and
 * the Jev client are supplied by the test.
 */

// biome-ignore lint/suspicious/noExplicitAny: handlers are looked up by name
type Handler = (ctx: any, args: any) => Promise<any>;

interface Row {
  _id: string;
  _creationTime: number;
  [field: string]: unknown;
}

function rank(value: unknown): number {
  return value === undefined ? 0 : value === null ? 1 : 2;
}

function compare(a: unknown, b: unknown): number {
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (rank(a) < 2) return 0;
  return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
}

type Constraint = { op: "eq" | "gte" | "lte" | "lt" | "gt"; field: string; value: unknown };

class FakeQuery {
  private constraints: Constraint[] = [];
  constructor(private readonly source: () => Row[]) {}

  withIndex(_name: string, build?: (q: unknown) => unknown): this {
    const q = {
      eq: (field: string, value: unknown) => this.add("eq", field, value, q),
      gte: (field: string, value: unknown) => this.add("gte", field, value, q),
      lte: (field: string, value: unknown) => this.add("lte", field, value, q),
      lt: (field: string, value: unknown) => this.add("lt", field, value, q),
      gt: (field: string, value: unknown) => this.add("gt", field, value, q),
    };
    build?.(q);
    return this;
  }

  private add(op: Constraint["op"], field: string, value: unknown, q: unknown) {
    this.constraints.push({ op, field, value });
    return q;
  }

  order(_direction: "asc" | "desc"): this {
    return this;
  }

  private rows(): Row[] {
    return this.source().filter((row) =>
      this.constraints.every(({ op, field, value }) => {
        const cell = row[field];
        if (op === "eq") return compare(cell, value) === 0;
        // A range on a number never matches a missing or null cell, except `lt`,
        // which Convex orders after undefined and null.
        if (op === "lt") return rank(cell) < 2 || compare(cell, value) < 0;
        if (rank(cell) < 2) return false;
        if (op === "gte") return compare(cell, value) >= 0;
        if (op === "gt") return compare(cell, value) > 0;
        return compare(cell, value) <= 0;
      }),
    );
  }

  async collect() {
    return this.rows().map((row) => ({ ...row }));
  }
  async *[Symbol.asyncIterator]() {
    for (const row of this.rows()) yield { ...row };
  }
  async take(n: number) {
    return (await this.collect()).slice(0, n);
  }
  async first() {
    return (await this.take(1))[0] ?? null;
  }
  async unique() {
    const rows = await this.collect();
    if (rows.length > 1) throw new Error("unique() matched several rows");
    return rows[0] ?? null;
  }
}

export class FakeDb {
  readonly tables = new Map<string, Row[]>();
  readonly storage = new Map<string, { _id: string; _creationTime: number }>();
  private counter = 0;

  table(name: string): Row[] {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = [];
      this.tables.set(name, rows);
    }
    return rows;
  }

  rows(name: string): Row[] {
    return this.table(name).map((row) => ({ ...row }));
  }

  query(name: string) {
    return new FakeQuery(() => this.table(name));
  }

  async insert(name: string, doc: Record<string, unknown>): Promise<string> {
    this.counter += 1;
    const _id = `${name}|${this.counter}`;
    this.table(name).push({ ...doc, _id, _creationTime: Date.now() });
    return _id;
  }

  async get(id: string) {
    const [name] = id.split("|");
    return this.table(name ?? "").find((row) => row._id === id) ?? null;
  }

  async patch(id: string, fields: Record<string, unknown>) {
    const row = await this.get(id);
    if (!row) throw new Error(`patch: no row ${id}`);
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) delete row[key];
      else row[key] = value;
    }
  }

  system = {
    normalizeId: (_table: string, id: string) => (this.storage.has(id) ? id : null),
    get: async (_table: string, id: string) => this.storage.get(id) ?? null,
  };

  addStorage(id: string, creationTime: number) {
    this.storage.set(id, { _id: id, _creationTime: creationTime });
  }
}

export interface FakeDeployment {
  db: FakeDb;
  /** `evidence:daily` scheduled `evidence:check` for these people, in order. */
  scheduled: { name: string; args: unknown }[];
  /** Run an exported handler of `convex/evidence.ts`, as the named function would run. */
  actionCtx(options?: { before?: (name: string) => Promise<void> }): unknown;
  mutationCtx(): unknown;
  call(
    name: string,
    args: unknown,
    options?: { before?: (name: string) => Promise<void> },
  ): Promise<unknown>;
}

export function createDeployment(input: {
  /** `evidence` exports, by function name. */
  evidence: Record<string, { _handler: Handler }>;
  getFunctionName: (ref: unknown) => string;
  /** Node actions and anything else outside `convex/evidence.ts`, by `module:name`. */
  external: Record<string, (args: unknown) => Promise<unknown>>;
}): FakeDeployment {
  const db = new FakeDb();
  const scheduled: { name: string; args: unknown }[] = [];
  let lock: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const next = lock.then(work, work);
    lock = next.catch(() => undefined);
    return next;
  };

  const dbCtx = () => ({
    db,
    scheduler: {
      runAfter: async (_ms: number, ref: unknown, args: unknown) => {
        scheduled.push({ name: input.getFunctionName(ref), args });
      },
    },
  });

  const dispatch = async (
    ref: unknown,
    args: unknown,
    options?: { before?: (name: string) => Promise<void> },
  ) => {
    const full = input.getFunctionName(ref);
    const [module, name] = full.split(":");
    if (options?.before) await options.before(full);
    if (module === "evidence") {
      const fn = input.evidence[name ?? ""];
      if (!fn) throw new Error(`no handler ${full}`);
      return await exclusive(() => fn._handler(dbCtx(), args));
    }
    const external = input.external[full];
    if (!external) throw new Error(`no external function ${full}`);
    return await external(args);
  };

  const actionCtx = (options?: { before?: (name: string) => Promise<void> }) => ({
    runQuery: (ref: unknown, args: unknown) => dispatch(ref, args, options),
    runMutation: (ref: unknown, args: unknown) => dispatch(ref, args, options),
    runAction: async (ref: unknown, args: unknown) => {
      const full = input.getFunctionName(ref);
      if (options?.before) await options.before(full);
      const external = input.external[full];
      if (!external) throw new Error(`no external function ${full}`);
      return await external(args);
    },
  });

  return {
    db,
    scheduled,
    actionCtx,
    mutationCtx: dbCtx,
    async call(name, args, options) {
      const [, fn] = name.split(":");
      const handler = input.evidence[fn ?? ""];
      if (!handler) throw new Error(`no handler ${name}`);
      const isAction = name === "evidence:check" || name === "evidence:intake";
      if (isAction) return await handler._handler(actionCtx(options), args);
      return await exclusive(() => handler._handler(dbCtx(), args));
    },
  };
}
