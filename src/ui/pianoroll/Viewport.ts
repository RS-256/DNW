/**
 * Viewport: the single owner of tick/key <-> pixel conversion for the piano
 * roll. Every renderer and input handler goes through this class so zooming
 * and scrolling only ever have to be correct in one place.
 *
 * Notes are square: the key row height always equals the tick width, so
 * zooming scales both axes together.
 *
 * World space: x = tick * pxPerTick, y = (keyMax - key) * keyHeight
 * (high keys at the top). Screen space = world space - scroll.
 */
import { KEY_MAX, KEY_MIN } from "../../core/model/song"

export const MIN_PX_PER_TICK = 6
export const MAX_PX_PER_TICK = 96

export class Viewport {
  pxPerTick = 24
  scrollX = 0
  scrollY = 0
  /** Visible screen size of the note area (excludes the keyboard sidebar). */
  width = 0
  height = 0

  readonly keyMin = KEY_MIN
  readonly keyMax = KEY_MAX

  /** Row height. Equals pxPerTick so note cells stay square. */
  get keyHeight(): number {
    return this.pxPerTick
  }

  get worldHeight(): number {
    return ( this.keyMax - this.keyMin + 1 ) * this.keyHeight
  }

  tickToX( tick: number ): number {
    return tick * this.pxPerTick - this.scrollX
  }

  keyToY( key: number ): number {
    return ( this.keyMax - key ) * this.keyHeight - this.scrollY
  }

  xToTick( x: number ): number {
    return ( x + this.scrollX ) / this.pxPerTick
  }

  yToKey( y: number ): number {
    return this.keyMax - Math.floor( ( y + this.scrollY ) / this.keyHeight )
  }

  firstVisibleTick(): number {
    return Math.max( 0, Math.floor( this.scrollX / this.pxPerTick ) )
  }

  lastVisibleTick(): number {
    return Math.ceil( ( this.scrollX + this.width ) / this.pxPerTick )
  }

  scrollBy( dx: number, dy: number ): void {
    this.scrollX += dx
    this.scrollY += dy
    this.clampScroll()
  }

  /** Zoom both axes, keeping the point under (anchorX, anchorY) stationary. */
  zoom( factor: number, anchorX: number, anchorY: number ): void {
    const anchorTick = this.xToTick( anchorX )
    const anchorRow = ( anchorY + this.scrollY ) / this.keyHeight
    this.pxPerTick = Math.min( MAX_PX_PER_TICK, Math.max( MIN_PX_PER_TICK, this.pxPerTick * factor ) )
    this.scrollX = anchorTick * this.pxPerTick - anchorX
    this.scrollY = anchorRow * this.keyHeight - anchorY
    this.clampScroll()
  }

  clampScroll(): void {
    this.scrollX = Math.max( 0, this.scrollX )
    this.scrollY = Math.max( 0, Math.min( Math.max( 0, this.worldHeight - this.height ), this.scrollY ) )
  }

  /** Center the note block native range (F#3-F#5) vertically. */
  centerOnNoteblockRange(): void {
    const centerKey = 45
    this.scrollY = ( this.keyMax - centerKey ) * this.keyHeight - this.height / 2
    this.clampScroll()
  }
}
