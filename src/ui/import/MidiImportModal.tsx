/**
 * Modal shown when opening a .mid/.midi file. MIDI has no gt/quarter concept,
 * so the user picks tickPerQuarter here (default 8). While typing, the file's
 * events are checked against the resulting game-tick grid and any conversion
 * compromise is warned about in red under the input; importing anyway snaps
 * the offending events to the nearest game tick.
 */
import { useEffect, useMemo, useState } from 'react';
import { analyzeMidiTiming } from '../../core/midi/convert';
import type { MidiFile } from '../../core/midi/reader';

export interface MidiImportModalProps {
  fileName: string;
  midi: MidiFile;
  onImport: (tickPerQuarter: number) => void;
  onCancel: () => void;
}

/** The grid unit of a tickPerQuarter, as a note-value denominator (8 gt/quarter → 1/32). */
const gridNoteValue = (tickPerQuarter: number) => 4 * tickPerQuarter;

export default function MidiImportModal({
  fileName,
  midi,
  onImport,
  onCancel,
}: MidiImportModalProps) {
  const [raw, setRaw] = useState('8');
  const value = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  const valid = Number.isInteger(value) && value >= 1;
  const analysis = useMemo(
    () => analyzeMidiTiming(midi, valid ? value : 1),
    [midi, valid, value],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [onCancel]);

  const trackCount = new Set(midi.notes.map((n) => n.track)).size;
  const lossy = valid && analysis.misalignedEvents > 0;

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog midi-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <span>Import MIDI</span>
          <button className="dialog-close" onClick={onCancel}>
            ×
          </button>
        </div>
        <p className="midi-info">
          {fileName} — {midi.notes.length} notes on {trackCount} track
          {trackCount === 1 ? '' : 's'}, {midi.ppq} MIDI ticks per quarter note.
        </p>
        <label
          className="midi-gt-row"
          title="Game ticks per quarter note. Playback speed is tps = bpm / 60 × this value (the same setting infinote uses). Higher values allow finer rhythms but make the song run at a higher tick rate."
        >
          <span>Game ticks per quarter note (gt/quarter)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            autoFocus
          />
        </label>
        {!valid && <p className="midi-warning">Enter a positive integer.</p>}
        {lossy && (
          <p className="midi-warning">
            {analysis.misalignedEvents} of {analysis.totalEvents} events fall off the 1/
            {gridNoteValue(value)}-note grid of gt/quarter = {value} and will be snapped to the
            nearest game tick.
          </p>
        )}
        {lossy && analysis.losslessTickPerQuarter !== null && (
          <p className="midi-warning">
            Lossless import needs gt/quarter = {analysis.losslessTickPerQuarter} (or a multiple of
            it).
          </p>
        )}
        {lossy && analysis.losslessTickPerQuarter === null && (
          <p className="midi-warning">
            No practical gt/quarter fits this file exactly — its timing is probably humanized
            (not quantized).
          </p>
        )}
        {valid && !lossy && (
          <p className="midi-note">
            {analysis.losslessTickPerQuarter !== null &&
            analysis.losslessTickPerQuarter < value ? (
              <>
                Every event fits this grid exactly (gt/quarter ={' '}
                {analysis.losslessTickPerQuarter} would already be enough).
              </>
            ) : (
              <>Every event fits this grid exactly.</>
            )}
          </p>
        )}
        <p className="midi-note">
          Note blocks cannot sustain, so MIDI note lengths are ignored: each note becomes a single
          one-tick note at its start position. Tempo and time-signature changes are imported into
          the tempo track.
        </p>
        <div className="confirm-buttons">
          <button className="confirm-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="export-confirm"
            disabled={!valid}
            onClick={() => valid && onImport(value)}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
