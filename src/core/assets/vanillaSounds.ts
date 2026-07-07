/**
 * Vanilla note block sample acquisition.
 *
 * Mojang assets are not redistributable, so nothing is bundled. Samples are
 * fetched from the official CDN on demand:
 *   version manifest -> version json -> asset index -> hashed object URL
 *
 * The JSON endpoints send `Access-Control-Allow-Origin: *`, but the object
 * store (resources.download.minecraft.net) does not, so binary fetches go
 * through `RESOURCE_BASE` (a dev-server proxy on the web; direct on Tauri).
 */
import type { VanillaInstrumentId } from '../model/types';

const VERSION_MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
const RESOURCE_BASE = '/mc-res';

interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>;
}

let assetIndexPromise: Promise<AssetIndex> | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return (await res.json()) as T;
}

function loadAssetIndex(): Promise<AssetIndex> {
  assetIndexPromise ??= (async () => {
    const manifest = await fetchJson<{
      latest: { release: string };
      versions: { id: string; url: string }[];
    }>(VERSION_MANIFEST_URL);
    const release = manifest.versions.find((v) => v.id === manifest.latest.release);
    if (!release) throw new Error('Latest release not found in version manifest');
    const version = await fetchJson<{ assetIndex: { url: string } }>(release.url);
    return fetchJson<AssetIndex>(version.assetIndex.url);
  })();
  return assetIndexPromise;
}

/** Instruments whose asset file name differs from the instrument id. */
const ASSET_NAME_OVERRIDES: Partial<Record<VanillaInstrumentId, string>> = {
  basedrum: 'bd',
  chime: 'icechime',
  xylophone: 'xylobone',
};

/** Asset-index key candidates for each vanilla instrument sample. */
function assetKeyCandidates(id: VanillaInstrumentId): string[] {
  const override = ASSET_NAME_OVERRIDES[id];
  const names = override ? [override, id] : [id];
  return names.map((n) => `minecraft/sounds/note/${n}.ogg`);
}

const soundPromises = new Map<VanillaInstrumentId, Promise<ArrayBuffer>>();

export function fetchVanillaSound(id: VanillaInstrumentId): Promise<ArrayBuffer> {
  let promise = soundPromises.get(id);
  if (!promise) {
    promise = (async () => {
      const index = await loadAssetIndex();
      for (const key of assetKeyCandidates(id)) {
        const obj = index.objects[key];
        if (!obj) continue;
        const url = `${RESOURCE_BASE}/${obj.hash.slice(0, 2)}/${obj.hash}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch ${key}: ${res.status}`);
        return res.arrayBuffer();
      }
      throw new Error(`No asset found for instrument "${id}"`);
    })();
    // Allow retrying after a failure (e.g. transient network error).
    promise.catch(() => soundPromises.delete(id));
    soundPromises.set(id, promise);
  }
  return promise;
}
