/**
 * NBS file writer. Always writes version 5.
 *
 * Export conventions:
 * - The header tempo is the tps of the initial bpm event.
 * - Additional bpm events are exported using the ONBS "Tempo Changer"
 *   convention: a custom instrument of that name plus one note per change
 *   (pitch = tps * 15) placed on an extra layer appended at the bottom.
 * - Information NBS cannot hold (track colors, per-instrument sound ids,
 *   time-signature changes beyond the initial one) is dropped.
 */
import { bpmToTps } from "../model/tempoMap"
import { songLength } from "../model/song"
import type { BpmEvent, Song } from "../model/types"
import { VANILLA_INSTRUMENT_IDS } from "../model/types"
import { ByteWriter } from "./bytes"
import { TEMPO_CHANGER_NAME } from "./reader"

const NBS_VERSION = 5

interface RawNote {
  tick: number
  layer: number
  instrument: number
  key: number
  velocity: number
  panning: number // 0-200
  pitch: number
}

export function writeNbs( song: Song ): ArrayBuffer {
  const w = new ByteWriter()
  const vanillaCount = VANILLA_INSTRUMENT_IDS.length

  // Map our instrument indexes to NBS indexes (vanilla stay 0-15, customs
  // are renumbered to start right after, Tempo Changer appended last).
  const customs = song.instruments.filter( ( inst ) => ! inst.isVanilla )
  const nbsIndexOf = new Map< number, number >()
  {
    let nextCustom = vanillaCount
    song.instruments.forEach( ( inst, i ) => {
      if ( inst.isVanilla ) {
        const vi = inst.vanillaId ? VANILLA_INSTRUMENT_IDS.indexOf( inst.vanillaId ) : 0
        nbsIndexOf.set( i, vi === -1 ? 0 : vi )
      } else {
        nbsIndexOf.set( i, nextCustom++ )
      }
    } )
  }

  const bpmEvents = song.tempoTrack.events
    .filter( ( e ): e is BpmEvent => e.type === "bpm" )
    .sort( ( a, b ) => a.tick - b.tick )
  const initialTps = bpmToTps( bpmEvents[ 0 ]?.bpm ?? 150, song.tickPerQuarter )
  const tempoChanges = bpmEvents.filter( ( e ) => e.tick > 0 )
  const tempoChangerIndex = vanillaCount + customs.length

  // --- flatten notes ---
  const raw: RawNote[] = []
  song.layers.forEach( ( layer, layerIndex ) => {
    for ( const note of layer.notes ) {
      raw.push( {
        tick: note.tick,
        layer: layerIndex,
        instrument: nbsIndexOf.get( note.instrument ) ?? 0,
        key: note.key,
        velocity: Math.round( note.velocity ),
        panning: Math.round( ( note.pan + 1 ) * 100 ),
        pitch: Math.round( note.pitch )
      } )
    }
  } )
  const tempoLayerIndex = song.layers.length
  for ( const ev of tempoChanges ) {
    raw.push( {
      tick: ev.tick,
      layer: tempoLayerIndex,
      instrument: tempoChangerIndex,
      key: 45,
      velocity: 0,
      panning: 100,
      pitch: Math.round( bpmToTps( ev.bpm, song.tickPerQuarter ) * 15 )
    } )
  }
  raw.sort( ( a, b ) => a.tick - b.tick || a.layer - b.layer )

  const layerCount = song.layers.length + ( tempoChanges.length > 0 ? 1 : 0 )
  const length = Math.max( 0, songLength( song ) + 1 )
  const timeSig = song.tempoTrack.events.find( ( e ) => e.type === "timeSignature" && e.tick === 0 )

  // --- header ---
  w.u16( 0 )
  w.u8( NBS_VERSION )
  w.u8( vanillaCount )
  w.u16( length )
  w.u16( layerCount )
  w.string( song.meta.name )
  w.string( song.meta.author )
  w.string( song.meta.originalAuthor )
  w.string( song.meta.description )
  w.u16( Math.round( initialTps * 100 ) )
  w.u8( 0 ) // auto-saving
  w.u8( 1 ) // auto-saving duration
  w.u8( timeSig?.type === "timeSignature" ? timeSig.numerator : 4 )
  w.i32( 0 ) // minutes spent
  w.i32( 0 ) // left clicks
  w.i32( 0 ) // right clicks
  w.i32( 0 ) // note blocks added
  w.i32( 0 ) // note blocks removed
  w.string( "" ) // MIDI/schematic file name
  w.u8( song.loop.enabled ? 1 : 0 )
  w.u8( Math.min( 255, song.loop.count ) )
  w.u16( song.loop.startTick )

  // --- note blocks (sparse double loop) ---
  let lastTick = -1
  let i = 0
  while ( i < raw.length ) {
    const tick = raw[ i ]!.tick
    w.u16( tick - lastTick )
    lastTick = tick
    let lastLayer = -1
    while ( i < raw.length && raw[ i ]!.tick === tick ) {
      const n = raw[ i ]!
      w.u16( n.layer - lastLayer )
      lastLayer = n.layer
      w.u8( n.instrument )
      w.u8( n.key )
      w.u8( n.velocity )
      w.u8( Math.max( 0, Math.min( 200, n.panning ) ) )
      w.i16( n.pitch )
      i++
    }
    w.u16( 0 ) // end of tick
  }
  w.u16( 0 ) // end of part

  // --- layers ---
  for ( const layer of song.layers ) {
    w.string( layer.name )
    w.u8( layer.locked ? 1 : 0 )
    w.u8( Math.round( layer.volume ) )
    w.u8( Math.max( 0, Math.min( 200, Math.round( ( layer.pan + 1 ) * 100 ) ) ) )
  }
  if ( tempoChanges.length > 0 ) {
    w.string( "Tempo" )
    w.u8( 1 )
    w.u8( 0 )
    w.u8( 100 )
  }

  // --- custom instruments ---
  const customCount = customs.length + ( tempoChanges.length > 0 ? 1 : 0 )
  w.u8( Math.min( 240, customCount ) )
  for ( const inst of customs ) {
    w.string( inst.name )
    w.string( inst.soundFile ?? "" )
    w.u8( inst.pitchKey )
    w.u8( inst.pressKey ? 1 : 0 )
  }
  if ( tempoChanges.length > 0 ) {
    w.string( TEMPO_CHANGER_NAME )
    w.string( "" )
    w.u8( 45 )
    w.u8( 0 )
  }

  return w.toArrayBuffer()
}
