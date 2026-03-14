import type { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';

type ShutdownState = {
  connections: Set<DuckDBConnection>;
  instances: Set<DuckDBInstance>;
  installed: boolean;
};

const state: ShutdownState = {
  connections: new Set(),
  instances: new Set(),
  installed: false,
};

function shutdown(): void {
  closeAll();
  process.exit(0);
}

function installHandlers(): void {
  if (state.installed) {
    return;
  }
  state.installed = true;
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/** Track a DuckDB instance for cleanup on process signal. */
export function trackInstance(instance: DuckDBInstance): void {
  installHandlers();
  state.instances.add(instance);
}

/** Track a DuckDB connection for cleanup on process signal. */
export function trackConnection(conn: DuckDBConnection): void {
  installHandlers();
  state.connections.add(conn);
}

/** Remove a connection from tracking (e.g. after normal close). */
export function untrackConnection(conn: DuckDBConnection): void {
  state.connections.delete(conn);
}

/** Close all tracked connections and instances. Call before process.exit(). */
export function closeAll(): void {
  for (const conn of state.connections) {
    try {
      conn.closeSync();
    } catch {
      // ignore
    }
  }
  state.connections.clear();

  for (const inst of state.instances) {
    try {
      inst.closeSync();
    } catch {
      // ignore
    }
  }
  state.instances.clear();
}
