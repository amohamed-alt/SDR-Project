const CHUNK_PATH_PATTERN = /\/_next\/static\/chunks\/[^\s"'?)]+/i;
const RECOVERABLE_ASSET_PATTERN = /ChunkLoadError|Loading chunk [^ ]+ failed|Failed to load chunk|Failed to fetch dynamically imported module|\/_next\/static\/chunks\//i;

function errorMessage(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error ?? "");
}

export function isRecoverableAssetError(error: unknown) {
  return RECOVERABLE_ASSET_PATTERN.test(errorMessage(error));
}

export function assetRecoveryStorageKey(error: unknown) {
  const message = errorMessage(error);
  const assetPath = message.match(CHUNK_PATH_PATTERN)?.[0] ?? "unknown-chunk";
  return `sdr:asset-recovery:${assetPath}`;
}
