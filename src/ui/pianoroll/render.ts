/**
 * Canvas renderers for the piano roll layers.
 * All drawing goes through the shared Viewport for coordinate conversion.
 */
import { NOTEBLOCK_KEY_MAX, NOTEBLOCK_KEY_MIN } from "../../core/model/song"
import type { Layer, Note, Song, TimeSignatureEvent } from "../../core/model/types"
import type { Viewport } from "./Viewport"

export const KEYBOARD_WIDTH = 64

const KEY_NAMES = [ "A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#" ] as const
const BLACK_KEY_PITCH_CLASSES = new Set( [ 1, 4, 6, 9, 11 ] )

export function keyName( key: number ): string {
  const octave = Math.floor( ( key + 9 ) / 12 )
  return `${ KEY_NAMES[ ( ( key % 12 ) + 12 ) % 12 ] }${ octave }`
}

export function isBlackKey( key: number ): boolean {
  return BLACK_KEY_PITCH_CLASSES.has( ( ( key % 12 ) + 12 ) % 12 )
}

interface SigSegment {
  startTick: number
  endTick: number
  ticksPerBeat: number
  ticksPerBar: number
  firstBarNumber: number
}

/** Split the song into time-signature segments with running bar numbers. */
function sigSegments( song: Song, untilTick: number ): SigSegment[] {
  const sigs = song.tempoTrack.events
    .filter( ( e ): e is TimeSignatureEvent => e.type === "timeSignature" )
    .sort( ( a, b ) => a.tick - b.tick )
  if ( sigs.length === 0 || sigs[ 0 ]!.tick !== 0 ) {
    sigs.unshift( { type: "timeSignature", tick: 0, numerator: 4, denominator: 4 } )
  }
  const segments: SigSegment[] = []
  let barNumber = 1
  for ( let i = 0; i < sigs.length; i++ ) {
    const sig = sigs[ i ]!
    const end = sigs[ i + 1 ]?.tick ?? Math.max( untilTick, sig.tick )
    const ticksPerBeat = Math.max( 1, Math.round( song.tickPerQuarter * ( 4 / sig.denominator ) ) )
    const ticksPerBar = ticksPerBeat * sig.numerator
    segments.push( {
      startTick: sig.tick,
      endTick: end,
      ticksPerBeat,
      ticksPerBar,
      firstBarNumber: barNumber
    } )
    barNumber += Math.max( 0, Math.ceil( ( end - sig.tick ) / ticksPerBar ) )
  }
  return segments
}

/** Grid + keyboard sidebar. Redrawn on scroll/zoom/resize only. */
export function renderGrid( ctx: CanvasRenderingContext2D, vp: Viewport, song: Song ): void {
  const w = vp.width + KEYBOARD_WIDTH
  const h = vp.height
  ctx.clearRect( 0, 0, w, h )

  // --- note area background: row stripes ---
  ctx.save()
  ctx.translate( KEYBOARD_WIDTH, 0 )
  ctx.beginPath()
  ctx.rect( 0, 0, vp.width, h )
  ctx.clip()

  const topKey = Math.min( vp.keyMax, vp.yToKey( 0 ) )
  const bottomKey = Math.max( vp.keyMin, vp.yToKey( h ) )
  for ( let key = bottomKey; key <= topKey; key++ ) {
    const y = vp.keyToY( key )
    const inRange = key >= NOTEBLOCK_KEY_MIN && key <= NOTEBLOCK_KEY_MAX
    ctx.fillStyle = isBlackKey( key ) ? (inRange ? "#1d1f25" : "#181a1f") : inRange ? "#23252d" : "#1d1f24"
    ctx.fillRect( 0, y, vp.width, vp.keyHeight )
  }

  // Note block range boundary lines.
  ctx.strokeStyle = "#4a4d58"
  ctx.lineWidth = 1
  for ( const key of [ NOTEBLOCK_KEY_MAX, NOTEBLOCK_KEY_MIN - 1 ] ) {
    const y = Math.round( vp.keyToY( key ) ) + 0.5
    ctx.beginPath()
    ctx.moveTo( 0, y )
    ctx.lineTo( vp.width, y )
    ctx.stroke()
  }

  // --- vertical tick/beat/bar lines, per time-signature segment ---
  const first = vp.firstVisibleTick()
  const last = vp.lastVisibleTick()
  const segments = sigSegments( song, last + 1 )

  ctx.font = "10px system-ui"
  ctx.textBaseline = "top"
  for ( const seg of segments ) {
    const from = Math.max( first, seg.startTick )
    const to = Math.min( last, seg.endTick - 1 )
    for ( let tick = from; tick <= to; tick++ ) {
      const rel = tick - seg.startTick
      const isBar = rel % seg.ticksPerBar === 0
      const isBeat = rel % seg.ticksPerBeat === 0
      if ( ! isBeat && vp.pxPerTick < 10 ) continue
      const x = Math.round( vp.tickToX( tick ) ) + 0.5
      ctx.strokeStyle = isBar ? "#565a66" : isBeat ? "#3a3d47" : "#2a2c34"
      ctx.beginPath()
      ctx.moveTo( x, 0 )
      ctx.lineTo( x, h )
      ctx.stroke()
      if ( isBar ) {
        ctx.fillStyle = "#7a7d88"
        ctx.fillText( String( seg.firstBarNumber + rel / seg.ticksPerBar ), vp.tickToX( tick ) + 3, 2 )
      }
    }
  }
  ctx.restore()

  // --- keyboard sidebar ---
  ctx.save()
  ctx.beginPath()
  ctx.rect( 0, 0, KEYBOARD_WIDTH, h )
  ctx.clip()
  for ( let key = bottomKey; key <= topKey; key++ ) {
    const y = vp.keyToY( key )
    const black = isBlackKey( key )
    ctx.fillStyle = black ? "#22242a" : "#e8e8ec"
    ctx.fillRect( 0, y, KEYBOARD_WIDTH, vp.keyHeight )
    ctx.strokeStyle = "#111216"
    ctx.strokeRect( -1, y + 0.5, KEYBOARD_WIDTH + 1, vp.keyHeight )
    if ( ( ( key % 12 ) + 12 ) % 12 === 9 ) {
      // Label every F# (the note block anchor pitch).
      ctx.fillStyle = black ? "#9a9ba3" : "#55565e"
      ctx.font = "9px system-ui"
      ctx.textBaseline = "middle"
      ctx.fillText( keyName( key ), 4, y + vp.keyHeight / 2 + 1 )
    }
  }
  ctx.restore()

  // Sidebar/grid divider.
  ctx.strokeStyle = "#0c0d10"
  ctx.beginPath()
  ctx.moveTo( KEYBOARD_WIDTH + 0.5, 0 )
  ctx.lineTo( KEYBOARD_WIDTH + 0.5, h )
  ctx.stroke()
}

/**
 * Draw one note body with the pan visualization: the rectangle is split at
 * its center and each half's opacity tracks the effective channel gain
 * (pan only redistributes volume between left and right).
 */
function fillNoteBody(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  note: Note,
  baseAlpha: number
): void {
  const leftGain = Math.min( 1, 1 - note.pan )
  const rightGain = Math.min( 1, 1 + note.pan )
  const halfW = w / 2
  ctx.globalAlpha = baseAlpha * leftGain
  ctx.fillRect( x, y, halfW, h )
  ctx.globalAlpha = baseAlpha * rightGain
  ctx.fillRect( x + halfW, y, w - halfW, h )
}

/**
 * Textured note body (skin feature): the prebaked tile is drawn in two
 * horizontal halves so pan can modulate each half's opacity, same as the
 * flat renderer.
 */
function drawTiledNoteBody(
  ctx: CanvasRenderingContext2D,
  tile: CanvasImageSource & { width: number; height: number },
  x: number,
  y: number,
  w: number,
  h: number,
  note: Note,
  baseAlpha: number
): void {
  const leftGain = Math.min( 1, 1 - note.pan )
  const rightGain = Math.min( 1, 1 + note.pan )
  const halfW = w / 2
  const srcHalf = tile.width / 2
  ctx.globalAlpha = baseAlpha * leftGain
  ctx.drawImage( tile, 0, 0, srcHalf, tile.height, x, y, halfW, h )
  ctx.globalAlpha = baseAlpha * rightGain
  ctx.drawImage( tile, srcHalf, 0, tile.width - srcHalf, tile.height, x + halfW, y, w - halfW, h )
}

/** Resolves the skin tile for an instrument index, or null for flat rendering. */
export type TileResolver = ( instrumentIndex: number ) => HTMLCanvasElement | null

export function renderLayerNotes(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  layer: Layer,
  opts: {
    active: boolean
    onionBaseAlpha?: number
    selection?: ReadonlySet< string >
    tileFor?: TileResolver
  }
): void {
  const firstTick = vp.firstVisibleTick() - 1
  const lastTick = vp.lastVisibleTick()
  const noteW = Math.max( 2, vp.pxPerTick - 1 )
  const noteH = Math.max( 2, vp.keyHeight - 1 )
  const onionAlpha = opts.onionBaseAlpha ?? 0.4

  for ( const note of layer.notes ) {
    if ( note.tick < firstTick || note.tick > lastTick ) continue
    const x = vp.tickToX( note.tick )
    const y = vp.keyToY( note.key )
    if ( y + noteH < 0 || y > vp.height ) continue

    const tile = opts.tileFor?.( note.instrument ) ?? null

    if ( opts.active ) {
      const alpha = 0.35 + 0.65 * ( note.velocity / 100 )
      if ( tile ) {
        drawTiledNoteBody( ctx, tile, x, y, noteW, noteH, note, alpha )
      } else {
        ctx.fillStyle = layer.color
        fillNoteBody( ctx, x, y, noteW, noteH, note, alpha )
      }
      ctx.globalAlpha = 1
      const selected = opts.selection?.has( note.id ) ?? false
      if ( selected || ! tile ) {
        ctx.strokeStyle = selected ? "#ffffff" : layer.color
        ctx.lineWidth = selected ? 1.5 : 1
        ctx.strokeRect( x + 0.5, y + 0.5, noteW - 1, noteH - 1 )
      }
    } else {
      // Onion skin: monochrome (or textured) fill, colored outline,
      // alpha scaled by velocity.
      const alpha = onionAlpha * ( note.velocity / 100 )
      if ( tile ) {
        drawTiledNoteBody( ctx, tile, x, y, noteW, noteH, note, alpha )
      } else {
        ctx.fillStyle = "#888888"
        fillNoteBody( ctx, x, y, noteW, noteH, note, alpha )
      }
      ctx.globalAlpha = onionAlpha
      ctx.strokeStyle = layer.color
      ctx.lineWidth = 1
      ctx.strokeRect( x + 0.5, y + 0.5, noteW - 1, noteH - 1 )
      ctx.globalAlpha = 1
    }
  }
  ctx.globalAlpha = 1
  ctx.lineWidth = 1
}

export interface SkinOptions {
  /** disabled = no tiles, activated = active track only, enabled = all tracks. */
  mode: "disabled" | "activated" | "enabled"
  tileFor: TileResolver
}

/** All note layers: inactive tracks in priority order (bottom first), active on top. */
export function renderNotes(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  song: Song,
  activeLayerIndex: number,
  selection: ReadonlySet< string >,
  skin?: SkinOptions
): void {
  ctx.clearRect( 0, 0, vp.width + KEYBOARD_WIDTH, vp.height )
  ctx.save()
  ctx.translate( KEYBOARD_WIDTH, 0 )
  ctx.beginPath()
  ctx.rect( 0, 0, vp.width, vp.height )
  ctx.clip()
  ctx.imageSmoothingEnabled = false

  const inactiveTiles = skin && skin.mode === "enabled" ? skin.tileFor : undefined
  const activeTiles = skin && skin.mode !== "disabled" ? skin.tileFor : undefined

  for ( let i = song.layers.length - 1; i >= 0; i-- ) {
    if ( i === activeLayerIndex ) continue
    renderLayerNotes( ctx, vp, song.layers[ i ]!, { active: false, tileFor: inactiveTiles } )
  }
  const active = song.layers[ activeLayerIndex ]
  if ( active ) renderLayerNotes( ctx, vp, active, { active: true, selection, tileFor: activeTiles } )
  ctx.restore()
}

export interface OverlayState {
  playheadTick: number | null
  /** true while playing (bright white line); false = parked position marker. */
  playheadActive?: boolean
  /** Selection box in note-area pixel coords. */
  selectionBox: { x0: number; y0: number; x1: number; y1: number } | null
  /** Drag-move preview. */
  ghost: { notes: Note[]; dTick: number; dKey: number; color: string } | null
}

export function renderOverlay( ctx: CanvasRenderingContext2D, vp: Viewport, state: OverlayState ): void {
  ctx.clearRect( 0, 0, vp.width + KEYBOARD_WIDTH, vp.height )
  ctx.save()
  ctx.translate( KEYBOARD_WIDTH, 0 )
  ctx.beginPath()
  ctx.rect( 0, 0, vp.width, vp.height )
  ctx.clip()

  if ( state.ghost ) {
    const { notes, dTick, dKey, color } = state.ghost
    const noteW = Math.max( 2, vp.pxPerTick - 1 )
    const noteH = Math.max( 2, vp.keyHeight - 1 )
    ctx.fillStyle = color
    ctx.strokeStyle = "#ffffff"
    ctx.setLineDash( [ 3, 2 ] )
    for ( const note of notes ) {
      const x = vp.tickToX( note.tick + dTick )
      const y = vp.keyToY( note.key + dKey )
      ctx.globalAlpha = 0.5
      ctx.fillRect( x, y, noteW, noteH )
      ctx.globalAlpha = 0.9
      ctx.strokeRect( x + 0.5, y + 0.5, noteW - 1, noteH - 1 )
    }
    ctx.setLineDash( [] )
    ctx.globalAlpha = 1
  }

  if ( state.selectionBox ) {
    const { x0, y0, x1, y1 } = state.selectionBox
    ctx.fillStyle = "rgba(94, 129, 244, 0.15)"
    ctx.strokeStyle = "rgba(120, 150, 255, 0.9)"
    ctx.fillRect( Math.min( x0, x1 ), Math.min( y0, y1 ), Math.abs( x1 - x0 ), Math.abs( y1 - y0 ) )
    ctx.strokeRect( Math.min( x0, x1 ) + 0.5, Math.min( y0, y1 ) + 0.5, Math.abs( x1 - x0 ), Math.abs( y1 - y0 ) )
  }

  if ( state.playheadTick !== null ) {
    const x = vp.tickToX( state.playheadTick )
    if ( x >= 0 && x <= vp.width ) {
      const active = state.playheadActive ?? true
      ctx.strokeStyle = active ? "#ffffff" : "#7a9bff"
      ctx.globalAlpha = active ? 0.8 : 0.9
      ctx.beginPath()
      ctx.moveTo( x, 0 )
      ctx.lineTo( x, vp.height )
      ctx.stroke()
      // Small triangle cap so the parked marker is easy to spot.
      if ( ! active ) {
        ctx.fillStyle = "#7a9bff"
        ctx.beginPath()
        ctx.moveTo( x - 4, 0 )
        ctx.lineTo( x + 4, 0 )
        ctx.lineTo( x, 6 )
        ctx.closePath()
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }
  }
  ctx.restore()
}
