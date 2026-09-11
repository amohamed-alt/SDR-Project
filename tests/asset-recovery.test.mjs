import assert from "node:assert/strict";
import test from "node:test";

import { assetRecoveryStorageKey, isRecoverableAssetError } from "../src/lib/asset-recovery.ts";

test("recognizes stale Next.js chunks and scopes one recovery attempt per asset", () => {
  const productionError = new Error("Failed to load chunk /_next/static/chunks/24-n_ddt412dh.js from module 19576");
  productionError.name = "ChunkLoadError";

  assert.equal(isRecoverableAssetError(productionError), true);
  assert.equal(
    assetRecoveryStorageKey(productionError),
    "sdr:asset-recovery:/_next/static/chunks/24-n_ddt412dh.js",
  );
});

test("does not reload for ordinary application errors", () => {
  assert.equal(isRecoverableAssetError(new Error("HubSpot snapshot is unavailable")), false);
});
