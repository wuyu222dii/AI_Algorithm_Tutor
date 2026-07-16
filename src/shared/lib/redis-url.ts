const LOCAL_REDIS_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
]);

export function isSafeRedisRestUrl(
  value: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    if (url.protocol !== 'http:') return false;
    if (env.NODE_ENV !== 'production') return true;
    return (
      env.REDIS_ALLOW_INSECURE_LOCAL === 'true' &&
      LOCAL_REDIS_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}
