/**
 * Unified export modal (docs/litematic-export-spec.md §9, phase 1).
 *
 * Top: output format pulldown. Left half: draggable track list whose order is
 * the output order (top entry = top NBS layer / shallowest schematic region)
 * with per-track include checkboxes. Right half: format-specific settings.
 *
 * Tracks muted when the modal opens start unchecked (and render dimmed while
 * unchecked), but the checkbox is the single source of truth: checking a
 * muted track exports it. Unchecked tracks are skipped without leaving a gap
 * in the output order.
 */
import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import type { Layer } from '../../core/model/types';
import { writeNbs } from '../../core/nbs/writer';
import { NBS_FILTER } from '../../core/platform/fileFilters';
import { webAdapter } from '../../core/platform/webAdapter';
import { useSongStore } from '../../state/songStore';

type ExportFormat = 'nbs';

interface TrackEntry {
  layerId: string;
  included: boolean;
}

function initialEntries(): TrackEntry[] {
  const song = useSongStore.getState().song;
  const groupMuted = new Map(song.groups.map((g) => [g.id, g.muted]));
  return song.layers.map((layer) => ({
    layerId: layer.id,
    included: !(layer.muted || (layer.groupId ? groupMuted.get(layer.groupId) : false)),
  }));
}

export default function ExportModal({ onClose }: { onClose: () => void }) {
  const song = useSongStore((s) => s.song);
  const [format, setFormat] = useState<ExportFormat>('nbs');
  const [entries, setEntries] = useState<TrackEntry[]>(initialEntries);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [onClose]);

  const layerById = new Map(song.layers.map((l) => [l.id, l]));
  const groupMuted = new Map(song.groups.map((g) => [g.id, g.muted]));
  const isMuted = (layer: Layer) =>
    layer.muted || (layer.groupId ? (groupMuted.get(layer.groupId) ?? false) : false);

  const setIncluded = (index: number, included: boolean) =>
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, included } : e)));

  const moveEntry = (from: number, to: number) =>
    setEntries((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });

  const dropOn = (e: DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) moveEntry(dragIndex, index);
    setDragIndex(null);
  };

  const onExport = () => {
    setError(null);
    void (async () => {
      const current = useSongStore.getState().song;
      const byId = new Map(current.layers.map((l) => [l.id, l]));
      const layers = entries
        .filter((e) => e.included)
        .map((e) => byId.get(e.layerId))
        .filter((l): l is Layer => l !== undefined);
      if (layers.length === 0) {
        setError('No tracks selected.');
        return;
      }
      const base = current.meta.name.trim() || 'untitled';
      const saved = await webAdapter.saveFile(`${base}.nbs`, writeNbs({ ...current, layers }), NBS_FILTER);
      if (saved) onClose();
    })().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const includedCount = entries.filter((e) => e.included).length;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog export-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <span>Export</span>
          <button className="dialog-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="export-format-row">
          <label htmlFor="export-format">Format</label>
          <select
            id="export-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
          >
            <option value="nbs">.nbs (Note Block Studio)</option>
            <option value="litematic" disabled>
              .litematic (not yet implemented)
            </option>
          </select>
        </div>
        <div className="export-body">
          <div className="export-tracks">
            {entries.map((entry, index) => {
              const layer = layerById.get(entry.layerId);
              if (!layer) return null;
              const muted = isMuted(layer);
              return (
                <div
                  key={entry.layerId}
                  className={`export-track-row${entry.included ? '' : ' excluded'}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => dropOn(e, index)}
                >
                  <span
                    className="track-grip"
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    title="Drag to reorder (top = top layer in the output)"
                  >
                    ⋮⋮
                  </span>
                  <input
                    type="checkbox"
                    checked={entry.included}
                    onChange={(e) => setIncluded(index, e.target.checked)}
                    title="Include this track in the export"
                  />
                  <span className="export-color-dot" style={{ background: layer.color }} />
                  <span className="export-track-name" title={layer.name}>
                    {layer.name}
                  </span>
                  {muted && <span className="export-muted-tag">muted</span>}
                  <span className="export-note-count">
                    {layer.notes.length} note{layer.notes.length === 1 ? '' : 's'}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="export-settings">
            {format === 'nbs' && (
              <>
                <p>No format-specific settings.</p>
                <p>
                  Tempo changes are exported as an ONBS “Tempo Changer” layer. Track colors,
                  instrument sound ids and extra time-signature changes are not stored in .nbs.
                </p>
              </>
            )}
          </div>
        </div>
        {error && <span className="file-menu-error">{error}</span>}
        <div className="confirm-buttons">
          <button className="confirm-cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="export-confirm" onClick={onExport} disabled={includedCount === 0}>
            Export {includedCount}/{entries.length} track{includedCount === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
