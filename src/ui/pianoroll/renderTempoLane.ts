/**
 * Tempo lane: a strip above the piano roll showing the tempo track
 * (bpm changes on the upper row, time signatures on the lower row).
 */
import type { Song, TempoEvent } from '../../core/model/types';
import { KEYBOARD_WIDTH } from './render';
import type { Viewport } from './Viewport';

export const TEMPO_LANE_HEIGHT = 30;

export interface TempoMarker {
  event: TempoEvent;
  /** Hit box in note-area pixel coords. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export function renderTempoLane(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  song: Song,
): TempoMarker[] {
  const w = vp.width + KEYBOARD_WIDTH;
  ctx.clearRect(0, 0, w, TEMPO_LANE_HEIGHT);
  ctx.fillStyle = '#1a1c21';
  ctx.fillRect(0, 0, w, TEMPO_LANE_HEIGHT);

  ctx.fillStyle = '#7a7d88';
  ctx.font = '9px system-ui';
  ctx.textBaseline = 'middle';
  ctx.fillText('tempo', 6, TEMPO_LANE_HEIGHT / 2);

  ctx.save();
  ctx.translate(KEYBOARD_WIDTH, 0);
  ctx.beginPath();
  ctx.rect(0, 0, vp.width, TEMPO_LANE_HEIGHT);
  ctx.clip();

  const markers: TempoMarker[] = [];
  const first = vp.firstVisibleTick();
  const last = vp.lastVisibleTick();
  ctx.font = '10px system-ui';

  for (const event of song.tempoTrack.events) {
    if (event.tick < first - 20 || event.tick > last) continue;
    const x = vp.tickToX(event.tick);
    const isBpm = event.type === 'bpm';
    const y = isBpm ? 2 : 16;
    const label = isBpm ? `♩=${event.bpm}` : `${event.numerator}/${event.denominator}`;
    const width = Math.max(28, ctx.measureText(label).width + 10);

    ctx.fillStyle = isBpm ? '#3e63dd' : '#8e4ec6';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, y, width, 12);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x + 4, y + 6.5);

    markers.push({ event, x, y, width, height: 12 });
  }

  ctx.restore();

  ctx.strokeStyle = '#0c0d10';
  ctx.beginPath();
  ctx.moveTo(0, TEMPO_LANE_HEIGHT - 0.5);
  ctx.lineTo(w, TEMPO_LANE_HEIGHT - 0.5);
  ctx.stroke();

  return markers;
}
