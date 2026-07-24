import { describe, expect, it } from "vitest"
import { TempoMap, bpmToTps } from "./tempoMap"
import type { TempoTrack } from "./types"

function track( events: TempoTrack[ "events" ] ): TempoTrack {
  return { events }
}

describe( "bpmToTps", () => {
  it( "converts bpm and tickPerQuarter to ticks per second", () => {
    // 150 bpm, 4 gt per quarter note => 150/60*4 = 10 tps
    expect( bpmToTps( 150, 4 ) ).toBe( 10 )
    expect( bpmToTps( 60, 4 ) ).toBe( 4 )
    expect( bpmToTps( 120, 2 ) ).toBe( 4 )
  } )
} )

describe( "TempoMap", () => {
  it( "maps ticks to seconds with a single bpm", () => {
    const map = new TempoMap( track( [ { type: "bpm", tick: 0, bpm: 150 } ] ), 4 ) // 10 tps
    expect( map.tickToSeconds( 0 ) ).toBe( 0 )
    expect( map.tickToSeconds( 10 ) ).toBe( 1 )
    expect( map.tickToSeconds( 25 ) ).toBe( 2.5 )
    expect( map.secondsToTick( 2.5 ) ).toBe( 25 )
  } )

  it( "handles bpm changes mid-song", () => {
    const map = new TempoMap(
      track( [
        { type: "bpm", tick: 0, bpm: 150 }, // 10 tps until tick 20
        { type: "bpm", tick: 20, bpm: 300 } // 20 tps after
      ] ),
      4
    )
    expect( map.tickToSeconds( 20 ) ).toBe( 2 )
    expect( map.tickToSeconds( 40 ) ).toBe( 3 ) // 20 ticks at 20 tps = 1s
    expect( map.secondsToTick( 3 ) ).toBe( 40 )
    expect( map.tpsAt( 0 ) ).toBe( 10 )
    expect( map.tpsAt( 19 ) ).toBe( 10 )
    expect( map.tpsAt( 20 ) ).toBe( 20 )
  } )

  it( "ignores time signature events for timing", () => {
    const map = new TempoMap(
      track( [
        { type: "timeSignature", tick: 0, numerator: 4, denominator: 4 },
        { type: "bpm", tick: 0, bpm: 150 },
        { type: "timeSignature", tick: 8, numerator: 3, denominator: 4 }
      ] ),
      4
    )
    expect( map.tickToSeconds( 10 ) ).toBe( 1 )
  } )

  it( "lets a later bpm event at the same tick override an earlier one", () => {
    const map = new TempoMap(
      track( [
        { type: "bpm", tick: 0, bpm: 150 },
        { type: "bpm", tick: 0, bpm: 300 }
      ] ),
      4
    )
    expect( map.tickToSeconds( 20 ) ).toBe( 1 )
  } )

  it( "throws without a bpm event at tick 0", () => {
    expect( () => new TempoMap( track( [ { type: "bpm", tick: 5, bpm: 150 } ] ), 4 ) ).toThrow()
    expect( () => new TempoMap( track( [] ), 4 ) ).toThrow()
  } )

  it( "roundtrips tick -> seconds -> tick across segments", () => {
    const map = new TempoMap(
      track( [
        { type: "bpm", tick: 0, bpm: 90 },
        { type: "bpm", tick: 13, bpm: 210 },
        { type: "bpm", tick: 40, bpm: 45 }
      ] ),
      8
    )
    for ( const tick of [ 0, 1, 12, 13, 14, 39, 40, 41, 100 ] ) {
      expect( map.secondsToTick( map.tickToSeconds( tick ) ) ).toBeCloseTo( tick, 10 )
    }
  } )
} )
