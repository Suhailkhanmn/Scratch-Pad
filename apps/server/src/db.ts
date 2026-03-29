import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DB_PATH = "data/scratch-pad.db";

export type DatabaseContext = {
  database: DatabaseSync;
  databasePath: string;
};

export function createDatabaseContext(): DatabaseContext {
  const databasePath = resolve(
    process.cwd(),
    process.env.SCRATCH_PAD_DB_PATH ?? DEFAULT_DB_PATH,
  );

  mkdirSync(dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);

  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  runMigrations(database);

  const upsertMeta = database.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  upsertMeta.run("app_name", "Scratch Pad");
  upsertMeta.run("phase", "6-review");

  return {
    database,
    databasePath,
  };
}

function runMigrations(database: DatabaseSync) {
  const appliedRows = database.prepare("SELECT name FROM migrations").all() as {
    name: string;
  }[];

  const appliedNames = new Set(appliedRows.map((row) => row.name));
  const migrationsDirectory = new URL("./db/migrations/", import.meta.url);

  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const insertMigration = database.prepare(`
    INSERT INTO migrations (name, applied_at)
    VALUES (?, ?)
  `);

  for (const migrationName of migrationFiles) {
    if (appliedNames.has(migrationName)) {
      continue;
    }

    const migrationSql = readFileSync(
      new URL(migrationName, migrationsDirectory),
      "utf8",
    );

    database.exec("BEGIN");

    try {
      database.exec(migrationSql);
      insertMigration.run(migrationName, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
