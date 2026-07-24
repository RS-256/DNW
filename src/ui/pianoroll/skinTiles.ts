/**
 * Prebaked note tiles for the skin feature.
 *
 * A tile is an offscreen canvas composed of the instrument's base-block
 * texture as the border ring and the note block texture as the inner fill.
 * Tiles are baked once per instrument and drawn with drawImage during note
 * rendering (never per-note pixel work).
 */
import { textureCandidates } from "../../core/assets/blockTextures"
import { textureStore } from "../../state/persistence"
import type { Instrument } from "../../core/model/types"

// Square tile to match the square note cells.
const TILE_W = 48
const TILE_H = 48
const BORDER = 6
const NOTE_BLOCK = "note_block"

class SkinTileCache {
  /** baseBlock id (or '') -> baked tile; null = bake attempted but failed. */
  private tiles = new Map< string, HTMLCanvasElement | null >()
  private bitmaps = new Map< string, ImageBitmap | null >()
  private preparing = false

  private async bitmapFor( names: string[] ): Promise< ImageBitmap | null > {
    const key = names[ 0 ]!
    if ( this.bitmaps.has( key ) ) return this.bitmaps.get( key )!
    let bitmap: ImageBitmap | null = null
    for ( const name of names ) {
      const data = await textureStore.get( name )
      if ( ! data ) continue
      try {
        bitmap = await createImageBitmap( new Blob( [ data ], { type: "image/png" } ) )
        break
      } catch {
        // corrupt entry; try next candidate
      }
    }
    this.bitmaps.set( key, bitmap )
    return bitmap
  }

  private tileKey( instrument: Instrument ): string {
    return instrument.baseBlock ?? ""
  }

  /** Synchronous lookup used by the renderer. */
  getTile( instrument: Instrument | undefined ): HTMLCanvasElement | null {
    if ( ! instrument ) return null
    return this.tiles.get( this.tileKey( instrument ) ) ?? null
  }

  /** Bake tiles for all instruments. Resolves true if new tiles were baked. */
  async prepare( instruments: Instrument[] ): Promise< boolean > {
    if ( this.preparing ) return false
    this.preparing = true
    try {
      let baked = false
      const noteBlock = await this.bitmapFor( [ NOTE_BLOCK ] )
      if ( ! noteBlock ) return false
      for ( const instrument of instruments ) {
        const key = this.tileKey( instrument )
        if ( this.tiles.has( key ) ) continue
        const base = instrument.baseBlock ? await this.bitmapFor( textureCandidates( instrument.baseBlock ) ) : null
        const canvas = document.createElement( "canvas" )
        canvas.width = TILE_W
        canvas.height = TILE_H
        const ctx = canvas.getContext( "2d" )!
        ctx.imageSmoothingEnabled = false
        // Border ring from the base block's texture, note block fill inside.
        ctx.drawImage( base ?? noteBlock, 0, 0, TILE_W, TILE_H )
        ctx.drawImage( noteBlock, BORDER, BORDER, TILE_W - BORDER * 2, TILE_H - BORDER * 2 )
        this.tiles.set( key, canvas )
        baked = true
      }
      return baked
    } finally {
      this.preparing = false
    }
  }

  /** Drop baked tiles (e.g. after new textures were imported). */
  invalidate(): void {
    this.tiles.clear()
    this.bitmaps.clear()
  }
}

export const skinTileCache = new SkinTileCache()
