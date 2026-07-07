/**
 * TempoMap: piecewise-linear mapping between ticks and seconds.
 *
 * Built from the song's tempo track. Each bpm event starts a new segment
 * with a constant tps (ticks per second):
 *   tps = bpm / 60 * tickPerQuarter
 *
 * Both the playback scheduler and the playhead renderer must share this
 * mapping so they never disagree about where "now" is.
 */
import type { BpmEvent, TempoTrack } from './types';

export interface TempoSegment {
  startTick: number;
  startSec: number;
  tps: number;
}

export function bpmToTps(bpm: number, tickPerQuarter: number): number {
  return (bpm / 60) * tickPerQuarter;
}

export class TempoMap {
  private readonly segments: TempoSegment[];

  constructor(tempoTrack: TempoTrack, tickPerQuarter: number) {
    const bpmEvents = tempoTrack.events
      .filter((e): e is BpmEvent => e.type === 'bpm')
      .sort((a, b) => a.tick - b.tick);
    if (bpmEvents.length === 0 || bpmEvents[0]!.tick !== 0) {
      throw new Error('Tempo track must contain a bpm event at tick 0');
    }
    const segments: TempoSegment[] = [];
    let sec = 0;
    for (let i = 0; i < bpmEvents.length; i++) {
      const ev = bpmEvents[i]!;
      const prev = segments[segments.length - 1];
      if (prev) {
        sec = prev.startSec + (ev.tick - prev.startTick) / prev.tps;
        // Later events at the same tick simply override earlier ones.
        if (ev.tick === prev.startTick) segments.pop();
      }
      segments.push({ startTick: ev.tick, startSec: sec, tps: bpmToTps(ev.bpm, tickPerQuarter) });
    }
    this.segments = segments;
  }

  private segmentAtTick(tick: number): TempoSegment {
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.segments[mid]!.startTick <= tick) lo = mid;
      else hi = mid - 1;
    }
    return this.segments[lo]!;
  }

  private segmentAtSec(sec: number): TempoSegment {
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.segments[mid]!.startSec <= sec) lo = mid;
      else hi = mid - 1;
    }
    return this.segments[lo]!;
  }

  tickToSeconds(tick: number): number {
    const s = this.segmentAtTick(tick);
    return s.startSec + (tick - s.startTick) / s.tps;
  }

  secondsToTick(sec: number): number {
    const s = this.segmentAtSec(sec);
    return s.startTick + (sec - s.startSec) * s.tps;
  }

  /** tps in effect at the given tick. */
  tpsAt(tick: number): number {
    return this.segmentAtTick(tick).tps;
  }
}
