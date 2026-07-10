/**
 * Unified export modal (docs/litematic-export-spec.md §9).
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
import { useEffect, useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import type { Layer, Song } from '../../core/model/types';
import { writeNbs } from '../../core/nbs/writer';
import { NBS_FILTER, PROJECT_FILTER } from '../../core/platform/fileFilters';
import { webAdapter } from '../../core/platform/webAdapter';
import {
  loadAllocation,
  saveAllocation,
  seedFromInfinoteJson,
  buildInfinoteConfig,
} from '../../core/infinote/allocation';
import type { AllocationState, ResolvedSlot } from '../../core/infinote/allocation';
import { DEFAULT_TEMPO_DEPTH, generateLitematic } from '../../core/infinote/generate';
import { buildManifest, collectVanillaUsage } from '../../core/infinote/manifest';
import type { ManifestSlotRow } from '../../core/infinote/manifest';
import {
  buildResourcePack,
  collectManagedInstruments,
  detectStereoSounds,
} from '../../core/infinote/resourcepack';
import { collectSlots, effectiveSoundId, normalizeId, slotKey } from '../../core/infinote/slots';
import { getSound } from '../../state/persistence';
import { useSongStore } from '../../state/songStore';
import LitematicSettings, { DEFAULT_LITEMATIC_OPTIONS } from './LitematicSettings';
import type { LitematicUiOptions } from './LitematicSettings';

type ExportFormat = 'nbs' | 'litematic';

const LITEMATIC_FILTER = {
  description: 'Litematica schematic',
  extensions: ['.litematic'],
  mime: 'application/octet-stream',
};
const ZIP_FILTER = {
  description: 'Resource pack',
  extensions: ['.zip'],
  mime: 'application/zip',
};

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

function orderedIncludedLayers(song: Song, entries: TrackEntry[]): Layer[] {
  const byId = new Map(song.layers.map((l) => [l.id, l]));
  return entries
    .filter((e) => e.included)
    .map((e) => byId.get(e.layerId))
    .filter((l): l is Layer => l !== undefined);
}

export default function ExportModal({ onClose }: { onClose: () => void }) {
  const song = useSongStore((s) => s.song);
  const [format, setFormat] = useState<ExportFormat>('nbs');
  const [entries, setEntries] = useState<TrackEntry[]>(initialEntries);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string[] | null>(null);
  const [litOptions, setLitOptions] = useState<LitematicUiOptions>(DEFAULT_LITEMATIC_OPTIONS);
  const [allocation, setAllocation] = useState<AllocationState>(loadAllocation);
  const [importStatus, setImportStatus] = useState<string | null>(null);

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

  const includedIds = useMemo(
    () => new Set(entries.filter((e) => e.included).map((e) => e.layerId)),
    [entries],
  );
  const slots = useMemo(
    () => [...collectSlots(song, includedIds).values()],
    [song, includedIds],
  );

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

  const setSlotBlock = (key: string, blockId: string) => {
    setAllocation((prev) => {
      const next = { ...prev, slots: { ...prev.slots, [key]: blockId } };
      if (blockId.trim() === '') delete next.slots[key];
      saveAllocation(next);
      return next;
    });
  };

  const onImportConfig = () => {
    setError(null);
    void (async () => {
      const file = await webAdapter.openFile([
        { ...PROJECT_FILTER, description: 'infinote config' },
      ]);
      if (!file) return;
      setAllocation((prev) => {
        const next: AllocationState = {
          slots: { ...prev.slots },
          imported: { ...prev.imported },
        };
        const count = seedFromInfinoteJson(next, new TextDecoder().decode(file.data));
        saveAllocation(next);
        setImportStatus(`Imported ${count} mappings from ${file.name}.`);
        return next;
      });
    })().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const exportNbs = async (current: Song, layers: Layer[]): Promise<boolean> => {
    const base = current.meta.name.trim() || 'untitled';
    return webAdapter.saveFile(`${base}.nbs`, writeNbs({ ...current, layers }), NBS_FILTER);
  };

  const exportLitematic = async (current: Song, layers: Layer[]): Promise<boolean> => {
    const layerIds = layers.map((l) => l.id);
    const included = new Set(layerIds);
    const usedSlots = [...collectSlots(current, included).values()];

    // Commit suggestions and validate that every slot has a base block.
    const resolved: ResolvedSlot[] = [];
    const nextAllocation: AllocationState = {
      slots: { ...allocation.slots },
      imported: { ...allocation.imported },
    };
    const missing: string[] = [];
    for (const slot of usedSlots) {
      const key = slotKey(slot.soundId, slot.pitchShift);
      const block = nextAllocation.slots[key] ?? slot.suggestedBlock;
      if (!block || block.trim() === '') {
        missing.push(key);
        continue;
      }
      nextAllocation.slots[key] = normalizeId(block);
      resolved.push({ soundId: slot.soundId, pitchShift: slot.pitchShift, blockId: block });
    }
    if (missing.length > 0) {
      throw new Error(`Assign base blocks first: ${missing.join(', ')}`);
    }
    saveAllocation(nextAllocation);
    setAllocation(nextAllocation);

    const result = generateLitematic(current, layerIds, nextAllocation, {
      ...litOptions,
      tempoDepth: DEFAULT_TEMPO_DEPTH,
    });

    const base = current.meta.name.trim() || 'untitled';
    const lines: string[] = [
      `Placed ${result.notesPlaced} notes` +
        (result.maxDbError > 0 ? ` (max placement error ${result.maxDbError.toFixed(2)} dB)` : ''),
      ...result.warnings,
    ];

    const saved = await webAdapter.saveFile(
      `${base}.litematic`,
      result.file.slice().buffer,
      LITEMATIC_FILTER,
    );
    if (!saved) return false;

    if (resolved.length > 0) {
      const { json, conflicts } = buildInfinoteConfig(nextAllocation, resolved);
      lines.push(...conflicts.map((c) => `Config conflict: ${c}`));
      await webAdapter.saveFile('infinote.json', json, {
        ...PROJECT_FILTER,
        description: 'infinote config',
      });
    }

    const managed = collectManagedInstruments(current, included);
    if (managed.length > 0) {
      const sounds = [];
      for (const inst of managed) {
        const data = inst.soundSourceId ? await getSound(inst.soundSourceId) : undefined;
        if (!data) {
          lines.push(`Sample for '${inst.name}' not found in the app storage; skipped.`);
          continue;
        }
        sounds.push({ soundId: effectiveSoundId(inst), data: new Uint8Array(data), raw: data });
      }
      if (sounds.length > 0) {
        lines.push(
          ...(await detectStereoSounds(sounds.map((s) => ({ name: s.soundId, data: s.raw })))),
        );
        const zip = buildResourcePack(
          sounds.map((s) => ({ soundId: s.soundId, data: s.data })),
          `DNW sounds for ${base}`,
        );
        await webAdapter.saveFile(`${base}_resources.zip`, zip.slice().buffer, ZIP_FILTER);
      }
    }

    if (litOptions.writeManifest) {
      const slotRows: ManifestSlotRow[] = usedSlots.map((slot) => ({
        blockId:
          nextAllocation.slots[slotKey(slot.soundId, slot.pitchShift)] ?? slot.suggestedBlock ?? '?',
        soundId: slot.soundId,
        pitchShift: slot.pitchShift,
        count: slot.count,
      }));
      const manifest = buildManifest({
        songName: base,
        generatedAt: new Date(),
        options: { ...litOptions, tempoDepth: DEFAULT_TEMPO_DEPTH },
        placement: result.placement,
        slotRows,
        vanillaRows: collectVanillaUsage(current, included),
        warnings: lines.filter((l) => !l.startsWith('Placed ')),
      });
      await webAdapter.saveFile(`${base}_manifest.md`, manifest, {
        description: 'Export manifest',
        extensions: ['.md'],
        mime: 'text/markdown',
      });
    }

    setSummary(lines);
    return true;
  };

  const onExport = () => {
    setError(null);
    setSummary(null);
    void (async () => {
      const current = useSongStore.getState().song;
      const layers = orderedIncludedLayers(current, entries);
      if (layers.length === 0) {
        setError('No tracks selected.');
        return;
      }
      const saved =
        format === 'nbs' ? await exportNbs(current, layers) : await exportLitematic(current, layers);
      if (saved && format === 'nbs') onClose();
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
        <div
          className="export-format-row"
          title=".nbs = Note Block Studio project; .litematic = spatial note block structure played by running through it (needs the infinote mod)"
        >
          <label htmlFor="export-format">Format</label>
          <select
            id="export-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
          >
            <option value="nbs">.nbs (Note Block Studio)</option>
            <option value="litematic">.litematic (infinote runner structure)</option>
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
                    title="Drag to reorder (top = top layer / closest to the runner)"
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
            {format === 'nbs' ? (
              <>
                <p>No format-specific settings.</p>
                <p>
                  Tempo changes are exported as an ONBS “Tempo Changer” layer. Track colors,
                  instrument sound ids and extra time-signature changes are not stored in .nbs.
                </p>
              </>
            ) : (
              <LitematicSettings
                options={litOptions}
                setOptions={setLitOptions}
                slots={slots}
                allocation={allocation}
                setSlotBlock={setSlotBlock}
                onImportConfig={onImportConfig}
                importStatus={importStatus}
              />
            )}
          </div>
        </div>
        {error && <span className="file-menu-error">{error}</span>}
        {summary && (
          <div className="export-summary">
            {summary.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        )}
        <div className="confirm-buttons">
          <button className="confirm-cancel" onClick={onClose}>
            {summary ? 'Close' : 'Cancel'}
          </button>
          <button className="export-confirm" onClick={onExport} disabled={includedCount === 0}>
            Export {includedCount}/{entries.length} track{includedCount === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
