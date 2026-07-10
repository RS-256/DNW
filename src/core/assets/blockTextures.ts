/**
 * Block texture acquisition for the note skin feature.
 *
 * Block textures are not in the asset index — they live inside the client
 * jar. The jar (~25MB) is downloaded once (or provided by the user via drag &
 * drop), the `assets/minecraft/textures/block/*.png` entries are extracted
 * with fflate, and each PNG is cached in IndexedDB.
 *
 * The jar host (piston-data.mojang.com) sends `Access-Control-Allow-Origin: *`,
 * so it is fetched directly in both dev and production — no proxy needed.
 * Override the host with `VITE_MC_DATA_BASE` if required.
 */
import { unzipSync } from 'fflate';

const VERSION_MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
const DATA_BASE = import.meta.env.VITE_MC_DATA_BASE || 'https://piston-data.mojang.com';
const TEXTURE_PREFIX = 'assets/minecraft/textures/block/';

export interface TextureStore {
  get(name: string): Promise<ArrayBuffer | undefined>;
  put(name: string, data: ArrayBuffer): Promise<void>;
  has(): Promise<boolean>;
}

/** Extract block textures from a client jar buffer into the store. */
export async function extractJar(jar: ArrayBuffer, store: TextureStore): Promise<number> {
  const files = unzipSync(new Uint8Array(jar), {
    filter: (file) => file.name.startsWith(TEXTURE_PREFIX) && file.name.endsWith('.png'),
  });
  let count = 0;
  for (const [path, data] of Object.entries(files)) {
    const name = path.slice(TEXTURE_PREFIX.length, -'.png'.length);
    const copy = data.slice().buffer;
    await store.put(name, copy);
    count++;
  }
  return count;
}

/** Download the latest client jar and extract its block textures. */
export async function downloadTextures(
  store: TextureStore,
  onProgress?: (percent: number) => void,
): Promise<number> {
  const manifest = (await (await fetch(VERSION_MANIFEST_URL)).json()) as {
    latest: { release: string };
    versions: { id: string; url: string }[];
  };
  const release = manifest.versions.find((v) => v.id === manifest.latest.release);
  if (!release) throw new Error('Latest release not found');
  const version = (await (await fetch(release.url)).json()) as {
    downloads: { client: { url: string; size: number } };
  };
  const jarUrl = version.downloads.client.url.replace('https://piston-data.mojang.com', DATA_BASE);

  const res = await fetch(jarUrl);
  if (!res.ok || !res.body) throw new Error(`Failed to download client jar: ${res.status}`);
  const total = version.downloads.client.size;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(Math.min(99, Math.round((received / total) * 100)));
  }
  const jar = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    jar.set(chunk, offset);
    offset += chunk.length;
  }
  const count = await extractJar(jar.buffer, store);
  onProgress?.(100);
  return count;
}

/** Candidate texture names for a block id like "minecraft:stone". */
export function textureCandidates(blockId: string): string[] {
  const name = blockId.includes(':') ? blockId.split(':')[1]! : blockId;
  return [name, `${name}_side`, `${name}_top`, `${name}_block`];
}
