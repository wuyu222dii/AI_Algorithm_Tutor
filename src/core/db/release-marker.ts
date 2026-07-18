export type DatabaseReleaseChannel = 'staging' | 'production';

const commitShaPattern = /^[a-f0-9]{40}$/i;

export function createDatabaseReleaseMarker(
  channel: string,
  releaseId: string
): string {
  if (channel !== 'staging' && channel !== 'production') {
    throw new Error('invalid_database_release_channel');
  }
  if (!commitShaPattern.test(releaseId)) {
    throw new Error('invalid_database_release_id');
  }
  return `algocoach-release:${channel}:${releaseId.toLowerCase()}`;
}

export function databaseReleaseMarkerMatches(
  actual: string | null | undefined,
  channel: string,
  releaseId: string
): boolean {
  try {
    return actual === createDatabaseReleaseMarker(channel, releaseId);
  } catch {
    return false;
  }
}
