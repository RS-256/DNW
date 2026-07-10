/**
 * LitematicaBitArray packing: palette indices stored `bits` wide, LSB-first,
 * entries spanning 64-bit long boundaries (unlike vanilla chunk packing,
 * which pads each long). Internally uses 32-bit lanes to avoid per-entry
 * BigInt math; lane 2j = low half of long j, lane 2j+1 = high half.
 */

/** Bits per entry for a palette of the given size (litematica minimum is 2). */
export function bitsForPalette(paletteSize: number): number {
  return Math.max(2, 32 - Math.clz32(Math.max(1, paletteSize - 1)));
}

/** Pack palette indices into the litematic long array (as bigints). */
export function packBitArray(indices: ArrayLike<number>, bits: number): bigint[] {
  const totalBits = indices.length * bits;
  const longCount = Math.ceil(totalBits / 64);
  const lanes = new Uint32Array(longCount * 2);

  for (let i = 0; i < indices.length; i++) {
    let value = indices[i]! >>> 0;
    let bitPos = i * bits;
    let remaining = bits;
    while (remaining > 0) {
      const lane = bitPos >>> 5;
      const offset = bitPos & 31;
      const take = Math.min(32 - offset, remaining);
      lanes[lane] = (lanes[lane]! | ((value << offset) >>> 0)) >>> 0;
      value = take >= 32 ? 0 : value >>> take;
      bitPos += take;
      remaining -= take;
    }
  }

  const longs: bigint[] = new Array(longCount);
  for (let j = 0; j < longCount; j++) {
    longs[j] = (BigInt(lanes[2 * j + 1]!) << 32n) | BigInt(lanes[2 * j]!);
  }
  return longs;
}

/** Unpack `count` entries from a litematic long array (used by tests/import). */
export function unpackBitArray(longs: readonly bigint[], bits: number, count: number): Uint32Array {
  const lanes = new Uint32Array(longs.length * 2);
  for (let j = 0; j < longs.length; j++) {
    const v = BigInt.asUintN(64, longs[j]!);
    lanes[2 * j] = Number(v & 0xffffffffn);
    lanes[2 * j + 1] = Number(v >> 32n);
  }

  const out = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    let value = 0;
    let bitPos = i * bits;
    let remaining = bits;
    let shift = 0;
    while (remaining > 0) {
      const lane = bitPos >>> 5;
      const offset = bitPos & 31;
      const take = Math.min(32 - offset, remaining);
      const mask = take >= 32 ? 0xffffffff : (1 << take) - 1;
      const chunk = (lanes[lane]! >>> offset) & mask;
      value = (value | (chunk << shift)) >>> 0;
      shift += take;
      bitPos += take;
      remaining -= take;
    }
    out[i] = value;
  }
  return out;
}
