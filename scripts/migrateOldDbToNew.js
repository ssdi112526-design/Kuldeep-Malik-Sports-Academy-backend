/**
 * Copy all public schema data from OLD Render DB → NEW Kuldeep DB.
 * Uses FK-safe insert order (Render disallows session_replication_role).
 *
 * Usage: node scripts/migrateOldDbToNew.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');

function readEnvFile() {
  return fs.readFileSync(envPath, 'utf8');
}

function parseDatabaseUrlFromLine(line) {
  const raw = String(line || '')
    .replace(/^\s*#\s*/, '')
    .trim();
  if (!raw.startsWith('DATABASE_URL=')) return null;
  return raw.slice('DATABASE_URL='.length).trim();
}

function toExternalRenderUrl(urlString) {
  const u = new URL(urlString);
  if (!u.hostname.includes('.') && u.hostname.startsWith('dpg-')) {
    u.hostname = `${u.hostname}.ohio-postgres.render.com`;
  }
  if (!u.searchParams.has('sslmode')) u.searchParams.set('sslmode', 'require');
  // Avoid pg v9 sslmode warning noise on current driver
  u.searchParams.set('uselibpqcompat', 'true');
  return u.toString();
}

function resolveOldUrl() {
  if (process.env.OLD_DATABASE_URL) return toExternalRenderUrl(process.env.OLD_DATABASE_URL);
  const lines = readEnvFile().split(/\r?\n/);
  const commented = lines.find(
    (l) => l.trim().startsWith('#') && l.includes('DATABASE_URL=') && l.includes('raghunandanakhada')
  );
  if (!commented) {
    throw new Error('OLD_DATABASE_URL not set and no commented raghunandanakhada DATABASE_URL found in .env');
  }
  return toExternalRenderUrl(parseDatabaseUrlFromLine(commented));
}

function resolveNewUrl() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
  const u = new URL(process.env.DATABASE_URL);
  if (!u.searchParams.has('sslmode')) u.searchParams.set('sslmode', 'require');
  u.searchParams.set('uselibpqcompat', 'true');
  return u.toString();
}

function safeLabel(urlString) {
  const u = new URL(urlString);
  return `${u.hostname}${u.pathname}`;
}

/** Parents before children. users first without student/coach FKs; patched later. */
const TABLE_ORDER = [
  'permissions',
  'roles',
  'role_permissions',
  'users',
  'contacts',
  'services',
  'products',
  'partners',
  'team_members',
  'faqs',
  'coverage_areas',
  'programs',
  'gallery_items',
  'facilities',
  'features',
  'membership_plans',
  'site_settings',
  'achievements',
  'schedule_sessions',
  'schedule_days',
  'videos',
  'students',
  'student_documents',
  'coaches',
  'coach_documents',
  'equipment',
  'equipment_history',
  'attendance_location_settings',
  'biometric_devices',
  'biometric_device_logs',
  'attendance_sessions',
  'attendance',
  'coach_attendance_sessions',
  'coach_attendance',
  'student_fee_months',
  'student_fee_payments',
  'coach_payments',
  'finance_sequences',
  'audit_logs',
  'media_blobs',
];

async function listTables(client) {
  const { rows } = await client.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `);
  return rows.map((r) => r.tablename);
}

async function copyTable(oldClient, newClient, table, { nullifyCols = [], batchSize = 250 } = {}) {
  const { rows } = await oldClient.query(`SELECT * FROM "${table}"`);
  if (!rows.length) {
    console.log(`  ${table}: 0 rows`);
    return 0;
  }

  const cols = Object.keys(rows[0]);
  const colSql = cols.map((c) => `"${c}"`).join(', ');
  const size = table === 'media_blobs' ? 5 : batchSize;

  let inserted = 0;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const params = [];
    const valueGroups = chunk.map((row, rowIndex) => {
      const parts = cols.map((c, colIndex) => {
        params.push(nullifyCols.includes(c) ? null : row[c]);
        return `$${rowIndex * cols.length + colIndex + 1}`;
      });
      return `(${parts.join(', ')})`;
    });

    await newClient.query(
      `INSERT INTO "${table}" (${colSql}) VALUES ${valueGroups.join(', ')}`,
      params
    );
    inserted += chunk.length;
    if (rows.length > size) {
      process.stdout.write(`\r  ${table}: ${inserted}/${rows.length}`);
    }
  }
  if (rows.length > size) process.stdout.write('\n');
  else console.log(`  ${table}: ${inserted} rows`);
  return inserted;
}

async function patchUserLinks(oldClient, newClient) {
  const { rows } = await oldClient.query(
    `SELECT id, student_id, coach_id FROM users WHERE student_id IS NOT NULL OR coach_id IS NOT NULL`
  );
  let n = 0;
  for (const row of rows) {
    await newClient.query(`UPDATE users SET student_id = $2, coach_id = $3 WHERE id = $1`, [
      row.id,
      row.student_id,
      row.coach_id,
    ]);
    n += 1;
  }
  console.log(`  users FK patch: ${n} rows`);
}

async function main() {
  const oldUrl = resolveOldUrl();
  const newUrl = resolveNewUrl();
  if (safeLabel(oldUrl) === safeLabel(newUrl)) {
    throw new Error('OLD and NEW database URLs resolve to the same host/db — aborting');
  }

  console.log('OLD:', safeLabel(oldUrl));
  console.log('NEW:', safeLabel(newUrl));

  const oldClient = new pg.Client({
    connectionString: oldUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 60_000,
  });
  const newClient = new pg.Client({
    connectionString: newUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 60_000,
  });

  await oldClient.connect();
  await newClient.connect();
  console.log('Connected to both databases');

  const existing = await listTables(oldClient);
  const existingSet = new Set(existing);
  const ordered = TABLE_ORDER.filter((t) => existingSet.has(t));
  const extras = existing.filter((t) => !TABLE_ORDER.includes(t));
  if (extras.length) console.log('Extra tables (appended):', extras.join(', '));
  const tables = [...ordered, ...extras];

  await newClient.query('BEGIN');
  try {
    if (tables.length) {
      await newClient.query(
        `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`
      );
      console.log('Truncated destination tables');
    }

    let total = 0;
    for (const table of tables) {
      if (table === 'users') {
        total += await copyTable(oldClient, newClient, table, {
          nullifyCols: ['student_id', 'coach_id'],
        });
      } else {
        total += await copyTable(oldClient, newClient, table);
      }
    }

    await patchUserLinks(oldClient, newClient);
    await newClient.query('COMMIT');
    console.log(`Done. Copied ${total} rows across ${tables.length} tables.`);
  } catch (err) {
    await newClient.query('ROLLBACK');
    throw err;
  } finally {
    await oldClient.end().catch(() => {});
    await newClient.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message || err);
  process.exit(1);
});
