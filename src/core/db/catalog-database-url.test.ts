import { describe, expect, it } from 'vitest';

import {
  CatalogDatabaseUrlConfigurationError,
  validateCatalogDatabaseUrl,
  type CatalogDatabaseUrlErrorCode,
} from './catalog-database-url';

const VALID_URL =
  'postgresql://catalog_worker.project:encoded%20password@db.example.test:5432/postgres?sslmode=require';

function errorCode(value: string | undefined): CatalogDatabaseUrlErrorCode {
  try {
    validateCatalogDatabaseUrl(value);
    throw new Error('Expected validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(CatalogDatabaseUrlConfigurationError);
    return (error as CatalogDatabaseUrlConfigurationError).code;
  }
}

describe('catalog database URL validation', () => {
  it('accepts PostgreSQL URL aliases with encoded credentials', () => {
    expect(() => validateCatalogDatabaseUrl(VALID_URL)).not.toThrow();
    expect(() =>
      validateCatalogDatabaseUrl(
        'postgres://catalog_worker:secret@localhost:5432/algocoach'
      )
    ).not.toThrow();
  });

  it.each<[string | undefined, CatalogDatabaseUrlErrorCode]>([
    [undefined, 'missing'],
    [`CATALOG_DATABASE_URL=${VALID_URL}`, 'assignment_in_value'],
    [`"${VALID_URL}"`, 'wrapped_in_quotes'],
    [`\`${VALID_URL}\``, 'wrapped_in_backticks'],
    [` ${VALID_URL}`, 'contains_whitespace'],
    [
      'postgresql://catalog_worker:<PASSWORD>@db.example.test/postgres',
      'contains_placeholder',
    ],
    [
      'postgresql://catalog_worker:bad%value@db.example.test/postgres',
      'malformed_percent_encoding',
    ],
    ['not-a-url', 'invalid_url'],
    [
      'https://catalog_worker:secret@db.example.test/postgres',
      'unsupported_protocol',
    ],
    ['postgresql://:secret@db.example.test/postgres', 'missing_username'],
    [
      'postgresql://catalog_worker@db.example.test/postgres',
      'missing_password',
    ],
    ['postgresql://catalog_worker:secret@db.example.test', 'missing_database'],
    [
      'postgresql://catalog_worker:secret@db.example.test/postgres#fragment',
      'fragment_not_allowed',
    ],
  ])(
    'rejects unsafe configuration without parsing it at runtime',
    (value, code) => {
      expect(errorCode(value)).toBe(code);
    }
  );

  it('never includes the supplied secret in validation errors', () => {
    const secret = 'do-not-print-this-database-secret';
    const value = `CATALOG_DATABASE_URL=postgresql://worker:${secret}@db.example.test/postgres`;

    expect(() => validateCatalogDatabaseUrl(value)).toThrowError(
      expect.not.stringContaining(secret)
    );
  });
});
