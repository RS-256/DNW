/**
 * Piano roll: tempo lane + three stacked canvases (grid / notes / overlay)
 * managed imperatively for performance. React only owns the container and
 * the tempo-event popover; scroll and zoom live in a Viewport held in a ref
 * so wheel events never trigger React re-renders.
 *
 * Input model:
 * - left press on empty cell  -> add note on release; dragging instead starts
 *   a selection box
 * - left press on a note      -> select (ctrl toggles) and drag to move; the
 *   move previews as a ghost and commits once on release (one undo step)
 * - right press on a note     -> delete
 */
import { useEffect, useRef, useState } from 'react';
import { findNoteIndexAt } from '../../core/model/song';
import type { Note } from '../../core/model/types';
import { useEditorStore } from '../../state/editorStore';
import { audioEngine, usePlaybackStore } from '../../state/playbackStore';
import { useSettingsStore } from '../../state/settingsStore';
import * as actions from '../../state/songActions';
import { useSongStore } from '../../state/songStore';
import { skinTileCache } from './skinTiles';
import { KEYBOARD_WIDTH, renderGrid, renderNotes, renderOverlay } from './render';
import type { OverlayState } from './render';
import { renderTempoLane, TEMPO_LANE_HEIGHT } from './renderTempoLane';
import type { TempoMarker } from './renderTempoLane';
import TempoEventEditor from './TempoEventEditor';
import type { TempoEditorTarget } from './TempoEventEditor';
import { Viewport } from './Viewport';

const DRAG_THRESHOLD_PX = 4;

type DragState =
  | { type: 'none' }
  | { type: 'maybe-add'; tick: number; key: number; startX: number; startY: number }
  | { type: 'box'; startX: number; startY: number; curX: number; curY: number }
  | {
      type: 'move';
      notes: Note[];
      startTick: number;
      startKey: number;
      dTick: number;
      dKey: number;
      moved: boolean;
    };

function setupCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export default function PianoRoll() {
  const containerRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<HTMLCanvasElement>(null);
  const notesRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef(new Viewport());
  const centeredRef = useRef(false);
  const dragRef = useRef<DragState>({ type: 'none' });
  const markersRef = useRef<TempoMarker[]>([]);
  const [tempoEditor, setTempoEditor] = useState<TempoEditorTarget | null>(null);

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__dnwViewport = vpRef.current;
  }

  useEffect(() => {
    const container = containerRef.current!;
    const lane = laneRef.current!;
    const grid = gridRef.current!;
    const notes = notesRef.current!;
    const overlay = overlayRef.current!;
    const vp = vpRef.current;

    const drawLane = () => {
      markersRef.current = renderTempoLane(
        lane.getContext('2d')!,
        vp,
        useSongStore.getState().song,
      );
    };
    const drawGrid = () => renderGrid(grid.getContext('2d')!, vp, useSongStore.getState().song);
    const drawNotes = () => {
      const song = useSongStore.getState().song;
      const { activeLayer, selection } = useEditorStore.getState();
      const mode = useSettingsStore.getState().skinMode;
      const skin =
        mode === 'disabled'
          ? undefined
          : {
              mode,
              tileFor: (i: number) => skinTileCache.getTile(song.instruments[i]),
            };
      renderNotes(notes.getContext('2d')!, vp, song, activeLayer, selection, skin);
      if (mode !== 'disabled') {
        // Bake missing tiles in the background, then repaint once.
        void skinTileCache.prepare(song.instruments).then((baked) => {
          if (baked) drawNotes();
        });
      }
    };
    const drawOverlay = () => {
      const drag = dragRef.current;
      const playing = audioEngine.isPlaying;
      const state: OverlayState = {
        playheadTick: playing
          ? audioEngine.currentTick()
          : usePlaybackStore.getState().positionTick,
        playheadActive: playing,
        selectionBox:
          drag.type === 'box'
            ? { x0: drag.startX, y0: drag.startY, x1: drag.curX, y1: drag.curY }
            : null,
        ghost:
          drag.type === 'move' && drag.moved
            ? {
                notes: drag.notes,
                dTick: drag.dTick,
                dKey: drag.dKey,
                color:
                  useSongStore.getState().song.layers[useEditorStore.getState().activeLayer]
                    ?.color ?? '#ffffff',
              }
            : null,
      };
      renderOverlay(overlay.getContext('2d')!, vp, state);
    };
    const drawAll = () => {
      drawLane();
      drawGrid();
      drawNotes();
      drawOverlay();
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const rollHeight = Math.max(0, rect.height - TEMPO_LANE_HEIGHT);
      vp.width = Math.max(0, rect.width - KEYBOARD_WIDTH);
      vp.height = rollHeight;
      setupCanvas(lane, rect.width, TEMPO_LANE_HEIGHT);
      for (const c of [grid, notes, overlay]) setupCanvas(c, rect.width, rollHeight);
      if (!centeredRef.current && rollHeight > 0) {
        vp.centerOnNoteblockRange();
        centeredRef.current = true;
      }
      vp.clampScroll();
      drawAll();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const unsubSong = useSongStore.subscribe(drawAll);
    const unsubEditor = useEditorStore.subscribe(drawNotes);
    const unsubSettings = useSettingsStore.subscribe(drawNotes);
    const unsubPlayback = usePlaybackStore.subscribe(drawOverlay);

    // --- coordinate helpers ---
    /** Pointer position in note-area pixels (origin: left edge of the roll, below the lane). */
    const toAreaPx = (e: MouseEvent): { x: number; y: number } => {
      const rect = container.getBoundingClientRect();
      return {
        x: e.clientX - rect.left - KEYBOARD_WIDTH,
        y: e.clientY - rect.top - TEMPO_LANE_HEIGHT,
      };
    };
    const toCell = (px: { x: number; y: number }): { tick: number; key: number } | null => {
      if (px.x < 0) return null;
      const tick = Math.floor(vp.xToTick(px.x));
      const key = vp.yToKey(px.y);
      if (key < vp.keyMin || key > vp.keyMax || tick < 0) return null;
      return { tick, key };
    };

    const onMouseDown = (e: MouseEvent) => {
      // Pull keyboard focus away from top-bar inputs so shortcuts (Space
      // etc.) work immediately after touching the roll.
      const focused = document.activeElement as HTMLElement | null;
      if (focused && focused !== container && typeof focused.blur === 'function') focused.blur();
      container.focus({ preventScroll: true });

      const rect = container.getBoundingClientRect();
      const localY = e.clientY - rect.top;

      // --- tempo lane click ---
      if (localY < TEMPO_LANE_HEIGHT) {
        if (e.button !== 0) return;
        e.preventDefault();
        const areaX = e.clientX - rect.left - KEYBOARD_WIDTH;
        const hit = markersRef.current.find(
          (m) => areaX >= m.x && areaX <= m.x + m.width && localY >= m.y && localY <= m.y + m.height,
        );
        if (hit) {
          setTempoEditor({
            x: Math.min(e.clientX - rect.left, rect.width - 190),
            y: TEMPO_LANE_HEIGHT + 4,
            tick: hit.event.tick,
            event: hit.event,
          });
        } else if (areaX >= 0) {
          const tick = Math.max(0, Math.floor(vp.xToTick(areaX)));
          setTempoEditor({
            x: Math.min(e.clientX - rect.left, rect.width - 190),
            y: TEMPO_LANE_HEIGHT + 4,
            tick,
          });
        }
        return;
      }

      setTempoEditor(null);
      const px = toAreaPx(e);
      const cell = toCell(px);
      if (!cell) return;
      e.preventDefault();

      // Middle click: park the playhead (playback resumes from here).
      if (e.button === 1) {
        usePlaybackStore.getState().setPosition(Math.floor(vp.xToTick(Math.max(0, px.x))));
        return;
      }

      // Right press: box selection (click without drag selects the one cell).
      if (e.button === 2) {
        dragRef.current = { type: 'box', startX: px.x, startY: px.y, curX: px.x, curY: px.y };
        drawOverlay();
        return;
      }
      if (e.button !== 0) return;

      const song = useSongStore.getState().song;
      const editor = useEditorStore.getState();
      const layer = song.layers[editor.activeLayer];
      if (!layer) return;
      const hitIndex = findNoteIndexAt(layer.notes, cell.tick, cell.key);

      if (hitIndex === -1) {
        dragRef.current = {
          type: 'maybe-add',
          tick: cell.tick,
          key: cell.key,
          startX: px.x,
          startY: px.y,
        };
      } else {
        const note = layer.notes[hitIndex]!;
        if (e.ctrlKey || e.metaKey) {
          const next = new Set(editor.selection);
          if (next.has(note.id)) next.delete(note.id);
          else next.add(note.id);
          editor.setSelection(next);
          return;
        }
        if (!editor.selection.has(note.id)) editor.setSelection([note.id]);
        const selected = useEditorStore.getState().selection;
        dragRef.current = {
          type: 'move',
          notes: layer.notes.filter((n) => selected.has(n.id)),
          startTick: cell.tick,
          startKey: cell.key,
          dTick: 0,
          dKey: 0,
          moved: false,
        };
      }
    };

    const onWindowMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (drag.type === 'none') return;
      const px = toAreaPx(e);

      if (drag.type === 'maybe-add') {
        if (Math.hypot(px.x - drag.startX, px.y - drag.startY) > DRAG_THRESHOLD_PX) {
          dragRef.current = {
            type: 'box',
            startX: drag.startX,
            startY: drag.startY,
            curX: px.x,
            curY: px.y,
          };
          drawOverlay();
        }
        return;
      }
      if (drag.type === 'box') {
        drag.curX = px.x;
        drag.curY = px.y;
        actions.selectBox(
          Math.floor(vp.xToTick(Math.max(0, drag.startX))),
          Math.floor(vp.xToTick(Math.max(0, drag.curX))),
          vp.yToKey(drag.startY),
          vp.yToKey(drag.curY),
        );
        drawOverlay();
        return;
      }
      if (drag.type === 'move') {
        const cell = toCell(px);
        if (!cell) return;
        const dTick = cell.tick - drag.startTick;
        const dKey = cell.key - drag.startKey;
        if (dTick !== drag.dTick || dKey !== drag.dKey) {
          drag.dTick = dTick;
          drag.dKey = dKey;
          drag.moved = drag.moved || dTick !== 0 || dKey !== 0;
          drawOverlay();
        }
      }
    };

    const onWindowMouseUp = (e: MouseEvent) => {
      const drag = dragRef.current;
      dragRef.current = { type: 'none' };
      if (drag.type === 'maybe-add') {
        if (e.button !== 0) return;
        const note = actions.addNote(drag.tick, drag.key);
        if (note) usePlaybackStore.getState().previewNote(note);
      } else if (drag.type === 'box') {
        // Covers the no-move case (plain right click selects one cell).
        actions.selectBox(
          Math.floor(vp.xToTick(Math.max(0, drag.startX))),
          Math.floor(vp.xToTick(Math.max(0, drag.curX))),
          vp.yToKey(drag.startY),
          vp.yToKey(drag.curY),
        );
      } else if (drag.type === 'move' && drag.moved) {
        actions.moveSelection(drag.dTick, drag.dKey);
      }
      drawOverlay();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      if (e.ctrlKey) {
        const anchorX = e.clientX - rect.left - KEYBOARD_WIDTH;
        const anchorY = e.clientY - rect.top - TEMPO_LANE_HEIGHT;
        vp.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, Math.max(0, anchorX), Math.max(0, anchorY));
      } else if (e.shiftKey) {
        vp.scrollBy(e.deltaY, 0);
      } else {
        vp.scrollBy(e.deltaX, e.deltaY);
      }
      drawAll();
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('contextmenu', onContextMenu);

    return () => {
      observer.disconnect();
      unsubSong();
      unsubEditor();
      unsubSettings();
      unsubPlayback();
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  // Playhead animation loop, active only while playing.
  const playing = usePlaybackStore((s) => s.playing);
  useEffect(() => {
    const overlay = overlayRef.current!;
    const vp = vpRef.current;
    const ctx = overlay.getContext('2d')!;
    if (!playing) {
      renderOverlay(ctx, vp, {
        playheadTick: usePlaybackStore.getState().positionTick,
        playheadActive: false,
        selectionBox: null,
        ghost: null,
      });
      return;
    }
    let raf = 0;
    const frame = () => {
      renderOverlay(ctx, vp, {
        playheadTick: audioEngine.currentTick(),
        playheadActive: true,
        selectionBox: null,
        ghost: null,
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <div ref={containerRef} className="pianoroll" tabIndex={-1}>
      <canvas ref={laneRef} className="pianoroll-lane" />
      <canvas ref={gridRef} className="pianoroll-roll" />
      <canvas ref={notesRef} className="pianoroll-roll" />
      <canvas ref={overlayRef} className="pianoroll-roll" />
      {tempoEditor && (
        <TempoEventEditor target={tempoEditor} onClose={() => setTempoEditor(null)} />
      )}
    </div>
  );
}
