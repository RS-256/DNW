/**
 * Little-endian binary helpers for the NBS format.
 * NBS strings are a 32-bit length followed by that many single-byte
 * characters (Windows-1252 in practice).
 */

export class ByteReader {
  private readonly view: DataView
  private pos = 0
  private readonly decoder = new TextDecoder( "windows-1252" )

  constructor( buffer: ArrayBuffer ) {
    this.view = new DataView( buffer )
  }

  get eof(): boolean {
    return this.pos >= this.view.byteLength
  }

  remaining(): number {
    return this.view.byteLength - this.pos
  }

  u8(): number {
    const v = this.view.getUint8( this.pos )
    this.pos += 1
    return v
  }

  i8(): number {
    const v = this.view.getInt8( this.pos )
    this.pos += 1
    return v
  }

  u16(): number {
    const v = this.view.getUint16( this.pos, true )
    this.pos += 2
    return v
  }

  i16(): number {
    const v = this.view.getInt16( this.pos, true )
    this.pos += 2
    return v
  }

  i32(): number {
    const v = this.view.getInt32( this.pos, true )
    this.pos += 4
    return v
  }

  string(): string {
    const length = this.i32()
    if ( length < 0 || length > this.remaining() ) {
      throw new Error( `Invalid NBS string length ${ length } at offset ${ this.pos - 4 }` )
    }
    const bytes = new Uint8Array( this.view.buffer, this.view.byteOffset + this.pos, length )
    this.pos += length
    return this.decoder.decode( bytes )
  }
}

export class ByteWriter {
  private buffer = new Uint8Array( 1024 )
  private view = new DataView( this.buffer.buffer )
  private pos = 0

  private ensure( extra: number ): void {
    if ( this.pos + extra <= this.buffer.length ) return
    const next = new Uint8Array( Math.max( this.buffer.length * 2, this.pos + extra ) )
    next.set( this.buffer )
    this.buffer = next
    this.view = new DataView( next.buffer )
  }

  u8( v: number ): void {
    this.ensure( 1 )
    this.view.setUint8( this.pos, v & 0xff )
    this.pos += 1
  }

  u16( v: number ): void {
    this.ensure( 2 )
    this.view.setUint16( this.pos, v & 0xffff, true )
    this.pos += 2
  }

  i16( v: number ): void {
    this.ensure( 2 )
    this.view.setInt16( this.pos, v, true )
    this.pos += 2
  }

  i32( v: number ): void {
    this.ensure( 4 )
    this.view.setInt32( this.pos, v, true )
    this.pos += 4
  }

  /** Characters above U+00FF are replaced with '?'. */
  string( s: string ): void {
    this.i32( s.length )
    this.ensure( s.length )
    for ( let i = 0; i < s.length; i++ ) {
      const code = s.charCodeAt( i )
      this.view.setUint8( this.pos + i, code <= 0xff ? code : 0x3f )
    }
    this.pos += s.length
  }

  toArrayBuffer(): ArrayBuffer {
    return this.buffer.slice( 0, this.pos ).buffer
  }
}
