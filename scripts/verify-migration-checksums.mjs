import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDirectory = join(root, 'migrations');
const manifest = JSON.parse(
  await readFile(join(migrationsDirectory, 'manifest.json'), 'utf8'),
);

if (manifest.algorithm !== 'sha256' || !Array.isArray(manifest.migrations)) {
  throw new Error('migrations/manifest.json is invalid');
}

const failures = [];
for (const migration of manifest.migrations) {
  if (
    !migration
    || typeof migration.file !== 'string'
    || !/^[0-9a-f]{64}$/.test(migration.sha256)
  ) {
    failures.push('manifest contains an invalid migration entry');
    continue;
  }

  const contents = await readFile(join(migrationsDirectory, migration.file));
  const actual = createHash('sha256').update(contents).digest('hex');
  if (actual !== migration.sha256) {
    failures.push(`${migration.file}: expected ${migration.sha256}, received ${actual}`);
  }
}

if (failures.length) {
  throw new Error(`Migration checksum verification failed:\n${failures.join('\n')}`);
}

console.log(`Verified ${manifest.migrations.length} migration checksum(s).`);
