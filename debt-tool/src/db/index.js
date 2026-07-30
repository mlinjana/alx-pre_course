import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let db = null;

/**
 * Opens (and on first call, migrates) the database. SQLite is deliberate here:
 * a debt-review book is thousands of clients, not millions, and a single file
 * that can be backed up and encrypted wholesale is easier to keep POPIA-compliant
 * than a server someone has to remember to lock down.
 */
export function getDb() {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });
  db = new DatabaseSync(config.databaseFile);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(database = getDb()) {
  const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  database.exec(schema);
  return database;
}

/** Test helper: a throwaway in-memory database with the full schema applied. */
export function openMemoryDb() {
  const mem = new DatabaseSync(':memory:');
  mem.exec('PRAGMA foreign_keys = ON;');
  mem.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8').replace(/PRAGMA journal_mode = WAL;/, ''));
  return mem;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Runs `fn` inside a transaction, rolling back on any throw. Used wherever a
 * write spans more than one table — a snapshot plus its accounts must land
 * together or not at all, otherwise a client's total owed is briefly wrong.
 */
export function transaction(fn, database = getDb()) {
  database.exec('BEGIN');
  try {
    const result = fn(database);
    database.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // The rollback itself failing means the connection is already unusable;
      // surface the original error, which is the one that explains the failure.
    }
    throw err;
  }
}
