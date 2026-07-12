const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const URL_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;

function decodeForValidation(value: string): string | null {
  let decoded = value;

  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return null;
  }

  return decoded;
}

/**
 * Only allow same-origin path callbacks. Encoded protocol-relative and
 * backslash variants are rejected before the value reaches a router.
 */
export function isSafeInternalCallback(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  const candidate = value.trim();
  if (!candidate || CONTROL_CHARACTER_PATTERN.test(candidate)) return false;
  if (URL_SCHEME_PATTERN.test(candidate)) return false;
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return false;
  if (candidate.includes('\\')) return false;

  const decoded = decodeForValidation(candidate);
  if (!decoded || CONTROL_CHARACTER_PATTERN.test(decoded)) return false;
  if (URL_SCHEME_PATTERN.test(decoded)) return false;
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return false;
  if (decoded.includes('\\')) return false;

  try {
    const base = new URL('https://internal.invalid');
    const parsed = new URL(candidate, base);
    return parsed.origin === base.origin && parsed.pathname.startsWith('/');
  } catch {
    return false;
  }
}

export function getSafeInternalCallback(
  value: unknown,
  fallback = '/'
): string {
  if (isSafeInternalCallback(value)) return value.trim();
  return isSafeInternalCallback(fallback) ? fallback.trim() : '/';
}
