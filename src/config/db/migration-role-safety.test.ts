import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  resolve(process.cwd(), 'src/config/db/migrations/0020_open_tiger_shark.sql'),
  'utf8'
);

describe('catalog capability role migration', () => {
  it('does not alter roles after creation', () => {
    expect(migrationSql).not.toMatch(/\bALTER\s+ROLE\b/i);
    expect(migrationSql).not.toMatch(/\bPASSWORD\s+NULL\b/i);
  });

  it('creates missing roles safely and validates existing role attributes', () => {
    expect(migrationSql).toContain(
      'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT'
    );
    expect(migrationSql).toContain('capability_role."rolcanlogin"');
    expect(migrationSql).toContain('capability_role."rolsuper"');
    expect(migrationSql).toContain('capability_role."rolcreatedb"');
    expect(migrationSql).toContain('capability_role."rolcreaterole"');
    expect(migrationSql).toContain('capability_role."rolinherit"');
  });
});
