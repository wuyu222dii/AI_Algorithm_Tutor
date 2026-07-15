export type CatalogDatabaseUrlErrorCode =
  | 'missing'
  | 'assignment_in_value'
  | 'wrapped_in_quotes'
  | 'wrapped_in_backticks'
  | 'contains_whitespace'
  | 'contains_placeholder'
  | 'malformed_percent_encoding'
  | 'invalid_url'
  | 'unsupported_protocol'
  | 'missing_username'
  | 'missing_password'
  | 'missing_hostname'
  | 'missing_database'
  | 'fragment_not_allowed';

const ERROR_MESSAGES: Record<CatalogDatabaseUrlErrorCode, string> = {
  missing:
    'Configure the CATALOG_DATABASE_URL GitHub Environment secret with a PostgreSQL connection URL.',
  assignment_in_value:
    'Store only the connection URL as the secret value; remove the DATABASE_URL= or CATALOG_DATABASE_URL= prefix.',
  wrapped_in_quotes:
    'Store the connection URL without surrounding single or double quotes.',
  wrapped_in_backticks:
    'Store the connection URL without surrounding Markdown backticks.',
  contains_whitespace:
    'Remove whitespace from the connection URL and percent-encode whitespace inside credentials.',
  contains_placeholder:
    'Replace placeholder text such as <PASSWORD> with the real percent-encoded credential.',
  malformed_percent_encoding:
    'Percent-encode credential characters using valid %HH byte sequences.',
  invalid_url:
    'The secret is not a valid absolute PostgreSQL URL. Check its username, encoded password, host, port, and database name.',
  unsupported_protocol:
    'The connection URL protocol must be postgresql:// or postgres://.',
  missing_username: 'The connection URL must include a database username.',
  missing_password:
    'The restricted catalog writer connection URL must include a password.',
  missing_hostname: 'The connection URL must include a database hostname.',
  missing_database: 'The connection URL must include a database name.',
  fragment_not_allowed:
    'URL fragments are not supported. Percent-encode any # character inside the password as %23.',
};

export class CatalogDatabaseUrlConfigurationError extends Error {
  readonly code: CatalogDatabaseUrlErrorCode;

  constructor(code: CatalogDatabaseUrlErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'CatalogDatabaseUrlConfigurationError';
    this.code = code;
  }
}

function fail(code: CatalogDatabaseUrlErrorCode): never {
  throw new CatalogDatabaseUrlConfigurationError(code);
}

function hasMalformedPercentEncoding(value: string): boolean {
  for (
    let index = value.indexOf('%');
    index >= 0;
    index = value.indexOf('%', index + 1)
  ) {
    if (!/^[0-9a-f]{2}$/i.test(value.slice(index + 1, index + 3))) {
      return true;
    }
  }
  return false;
}

/**
 * Validates a restricted catalog worker URL without connecting or returning any
 * component that could accidentally be written to CI logs.
 */
export interface ValidatedCatalogDatabaseUrl {
  configuredUsername: string;
}

export function validateCatalogDatabaseUrl(
  rawValue: string | undefined
): ValidatedCatalogDatabaseUrl {
  if (!rawValue) fail('missing');
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(rawValue)) {
    fail('assignment_in_value');
  }
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    fail('wrapped_in_quotes');
  }
  if (rawValue.startsWith('`') && rawValue.endsWith('`')) {
    fail('wrapped_in_backticks');
  }
  if (/\s/.test(rawValue)) fail('contains_whitespace');
  if (/[<>]/.test(rawValue)) fail('contains_placeholder');
  if (hasMalformedPercentEncoding(rawValue)) {
    fail('malformed_percent_encoding');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    fail('invalid_url');
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    fail('unsupported_protocol');
  }
  if (!parsed.username) fail('missing_username');
  if (!parsed.password) fail('missing_password');
  if (!parsed.hostname) fail('missing_hostname');
  if (!parsed.pathname || parsed.pathname === '/') fail('missing_database');
  if (parsed.hash) fail('fragment_not_allowed');

  let configuredUsername: string;
  try {
    configuredUsername = decodeURIComponent(parsed.username);
  } catch {
    fail('malformed_percent_encoding');
  }
  return { configuredUsername };
}
