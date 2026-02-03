/**
 * Run all pending Supabase migrations against production DB.
 * Usage: node run_migrations.mjs
 * Reads DATABASE_URL from environment or .env file.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';

const __dir = dirname(fileURLToPath(import.meta.url));

// Load .env if present (supports quoted values and inline comments).
try {
  const env = readFileSync(join(__dir, '.env'), 'utf8');
  for (const rawLine of env.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separator = withoutExport.indexOf('=');
    if (separator <= 0) continue;

    const key = withoutExport.slice(0, separator).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || process.env[key]) continue;

    let value = withoutExport.slice(separator + 1).trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      const q = value[0];
      const closingIdx = value.indexOf(q, 1);
      if (closingIdx > 0) {
        // Extract content between the matching quotes, ignore anything after
        value = value.slice(1, closingIdx);
      } else {
        // No closing quote — treat as unquoted and strip trailing comment
        const comment = value.indexOf(' #');
        if (comment >= 0) value = value.slice(0, comment).trim();
      }
    } else {
      const comment = value.indexOf(' #');
      if (comment >= 0) {
        value = value.slice(0, comment).trim();
      }
    }

    process.env[key] = value;
  }
} catch {
  // No local .env file available.
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: DATABASE_URL.includes('railway.internal') ? false : 'require' });

function stripOuterTransaction(sqlText) {
  const trimmed = sqlText.trim();
  const beginMatch = trimmed.match(/^BEGIN\s*;\s*/i);
  const commitMatch = trimmed.match(/\s*COMMIT\s*;?\s*$/i);
  if (!beginMatch || !commitMatch) {
    return trimmed;
  }
  return trimmed.slice(beginMatch[0].length, trimmed.length - commitMatch[0].length).trim();
}

// Ensure migrations tracking table exists
await sql`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT now()
  )
`;

// Find applied migrations
const applied = new Set(
  (await sql`SELECT name FROM schema_migrations ORDER BY name`).map(r => r.name)
);

// Find migration files
const migrationsDir = join(__dir, 'supabase/migrations');
const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

let ran = 0;
for (const file of files) {
  if (applied.has(file)) {
    console.log(`✓ ${file} (already applied)`);
    continue;
  }
  console.log(`→ Applying ${file}...`);
  const migrationPath = join(migrationsDir, file);
  try {
    const rawMigrationSql = readFileSync(migrationPath, 'utf8');
    const migrationSql = stripOuterTransaction(rawMigrationSql);
    await sql.begin(async (tx) => {
      await tx.unsafe(migrationSql);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    console.log(`  ✅ Done`);
    ran++;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    console.error(`  ❌ FAILED: ${message}`);
    await sql.end();
    process.exit(1);
  }
}

console.log(`\n${ran === 0 ? 'All migrations already applied.' : `Applied ${ran} migration(s).`}`);
await sql.end();
