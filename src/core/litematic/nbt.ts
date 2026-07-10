/**
 * Minimal NBT (Named Binary Tag) encoder/decoder, big-endian, uncompressed.
 * Only the tags the litematic format needs are supported. The decoder exists
 * for round-trip tests and future .litematic import.
 */

export type NbtTag =
  | { type: 'byte'; value: number }
  | { type: 'short'; value: number }
  | { type: 'int'; value: number }
  | { type: 'long'; value: bigint }
  | { type: 'float'; value: number }
  | { type: 'double'; value: number }
  | { type: 'byteArray'; value: Uint8Array }
  | { type: 'string'; value: string }
  | { type: 'list'; value: NbtTag[] }
  | { type: 'compound'; value: Record<string, NbtTag> }
  | { type: 'intArray'; value: number[] }
  | { type: 'longArray'; value: bigint[] };

const TAG_IDS: Record<NbtTag['type'], number> = {
  byte: 1,
  short: 2,
  int: 3,
  long: 4,
  float: 5,
  double: 6,
  byteArray: 7,
  string: 8,
  list: 9,
  compound: 10,
  intArray: 11,
  longArray: 12,
};

export const nByte = (value: number): NbtTag => ({ type: 'byte', value });
export const nShort = (value: number): NbtTag => ({ type: 'short', value });
export const nInt = (value: number): NbtTag => ({ type: 'int', value });
export const nLong = (value: bigint | number): NbtTag => ({ type: 'long', value: BigInt(value) });
export const nString = (value: string): NbtTag => ({ type: 'string', value });
export const nList = (value: NbtTag[]): NbtTag => ({ type: 'list', value });
export const nCompound = (value: Record<string, NbtTag>): NbtTag => ({ type: 'compound', value });
export const nLongArray = (value: bigint[]): NbtTag => ({ type: 'longArray', value });

class NbtWriter {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  private len = 0;

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.len, v);
    this.len += 1;
  }

  i16(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.len, v);
    this.len += 2;
  }

  i32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.len, v);
    this.len += 4;
  }

  i64(v: bigint): void {
    this.ensure(8);
    this.view.setBigInt64(this.len, BigInt.asIntN(64, v));
    this.len += 8;
  }

  f32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.len, v);
    this.len += 4;
  }

  f64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.len, v);
    this.len += 8;
  }

  string(s: string): void {
    const bytes = new TextEncoder().encode(s);
    this.ensure(2 + bytes.length);
    this.view.setUint16(this.len, bytes.length);
    this.len += 2;
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }

  payload(tag: NbtTag): void {
    switch (tag.type) {
      case 'byte':
        this.u8(tag.value & 0xff);
        break;
      case 'short':
        this.i16(tag.value);
        break;
      case 'int':
        this.i32(tag.value);
        break;
      case 'long':
        this.i64(tag.value);
        break;
      case 'float':
        this.f32(tag.value);
        break;
      case 'double':
        this.f64(tag.value);
        break;
      case 'byteArray':
        this.i32(tag.value.length);
        this.bytes(tag.value);
        break;
      case 'string':
        this.string(tag.value);
        break;
      case 'list': {
        // Empty lists use element type 0 (TAG_End), matching litematica.
        const elemId = tag.value.length > 0 ? TAG_IDS[tag.value[0]!.type] : 0;
        this.u8(elemId);
        this.i32(tag.value.length);
        for (const item of tag.value) this.payload(item);
        break;
      }
      case 'compound':
        for (const [name, child] of Object.entries(tag.value)) {
          this.u8(TAG_IDS[child.type]);
          this.string(name);
          this.payload(child);
        }
        this.u8(0);
        break;
      case 'intArray':
        this.i32(tag.value.length);
        for (const v of tag.value) this.i32(v);
        break;
      case 'longArray':
        this.i32(tag.value.length);
        for (const v of tag.value) this.i64(v);
        break;
    }
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

/** Encode a named root compound as uncompressed NBT bytes. */
export function encodeNbt(rootName: string, root: NbtTag): Uint8Array {
  const w = new NbtWriter();
  w.u8(TAG_IDS[root.type]);
  w.string(rootName);
  w.payload(root);
  return w.result();
}

class NbtReader {
  private view: DataView;
  private pos = 0;

  constructor(private buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  u8(): number {
    return this.view.getUint8(this.pos++);
  }

  i16(): number {
    const v = this.view.getInt16(this.pos);
    this.pos += 2;
    return v;
  }

  i32(): number {
    const v = this.view.getInt32(this.pos);
    this.pos += 4;
    return v;
  }

  i64(): bigint {
    const v = this.view.getBigInt64(this.pos);
    this.pos += 8;
    return v;
  }

  f32(): number {
    const v = this.view.getFloat32(this.pos);
    this.pos += 4;
    return v;
  }

  f64(): number {
    const v = this.view.getFloat64(this.pos);
    this.pos += 8;
    return v;
  }

  string(): string {
    const len = this.view.getUint16(this.pos);
    this.pos += 2;
    const s = new TextDecoder().decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }

  payload(tagId: number): NbtTag {
    switch (tagId) {
      case 1:
        return { type: 'byte', value: this.view.getInt8(this.pos++) };
      case 2:
        return { type: 'short', value: this.i16() };
      case 3:
        return { type: 'int', value: this.i32() };
      case 4:
        return { type: 'long', value: this.i64() };
      case 5:
        return { type: 'float', value: this.f32() };
      case 6:
        return { type: 'double', value: this.f64() };
      case 7: {
        const len = this.i32();
        const value = this.buf.slice(this.pos, this.pos + len);
        this.pos += len;
        return { type: 'byteArray', value };
      }
      case 8:
        return { type: 'string', value: this.string() };
      case 9: {
        const elemId = this.u8();
        const len = this.i32();
        const value: NbtTag[] = [];
        for (let i = 0; i < len; i++) value.push(this.payload(elemId));
        return { type: 'list', value };
      }
      case 10: {
        const value: Record<string, NbtTag> = {};
        for (;;) {
          const childId = this.u8();
          if (childId === 0) break;
          const name = this.string();
          value[name] = this.payload(childId);
        }
        return { type: 'compound', value };
      }
      case 11: {
        const len = this.i32();
        const value: number[] = [];
        for (let i = 0; i < len; i++) value.push(this.i32());
        return { type: 'intArray', value };
      }
      case 12: {
        const len = this.i32();
        const value: bigint[] = [];
        for (let i = 0; i < len; i++) value.push(this.i64());
        return { type: 'longArray', value };
      }
      default:
        throw new Error(`Unknown NBT tag id ${tagId}`);
    }
  }
}

/** Decode uncompressed NBT bytes into the named root compound. */
export function decodeNbt(bytes: Uint8Array): { name: string; root: NbtTag } {
  const r = new NbtReader(bytes);
  const tagId = r.u8();
  const name = r.string();
  return { name, root: r.payload(tagId) };
}
