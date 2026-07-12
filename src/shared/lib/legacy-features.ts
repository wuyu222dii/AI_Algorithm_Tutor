export function legacyFeaturesEnabled(): boolean {
  return process.env.ENABLE_LEGACY_FEATURES === 'true';
}

export function legacyFeatureDisabledResponse(): Response {
  return Response.json(
    {
      error: 'feature_disabled',
      message: 'This legacy template feature is disabled.',
    },
    { status: 404 }
  );
}
