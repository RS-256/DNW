/**
 * Right-pane settings for the .litematic export format
 * (docs/litematic-export-spec.md §9): placement options plus the infinote
 * slot table (import existing infinote.json as the allocation seed, assign
 * base blocks to unresolved slots).
 */
import type { AllocationState } from '../../core/infinote/allocation';
import type { PaletteRegionMode } from '../../core/infinote/generate';
import type { PlacementSide } from '../../core/infinote/placement';
import type { Slot } from '../../core/infinote/slots';
import { slotKey } from '../../core/infinote/slots';

export interface LitematicUiOptions {
  side: PlacementSide;
  includeRotation: boolean;
  applyMixerVolumes: boolean;
  alpha: number;
  firstDepth: number;
  spacing: number;
  paletteRegion: PaletteRegionMode;
}

export const DEFAULT_LITEMATIC_OPTIONS: LitematicUiOptions = {
  side: 'below',
  includeRotation: false,
  applyMixerVolumes: true,
  alpha: 2,
  firstDepth: 2,
  spacing: 3,
  paletteRegion: 'song',
};

export interface LitematicSettingsProps {
  options: LitematicUiOptions;
  setOptions: (options: LitematicUiOptions) => void;
  slots: Slot[];
  allocation: AllocationState;
  setSlotBlock: (key: string, blockId: string) => void;
  onImportConfig: () => void;
  importStatus: string | null;
}

export default function LitematicSettings({
  options,
  setOptions,
  slots,
  allocation,
  setSlotBlock,
  onImportConfig,
  importStatus,
}: LitematicSettingsProps) {
  const set = <K extends keyof LitematicUiOptions>(key: K, value: LitematicUiOptions[K]) =>
    setOptions({ ...options, [key]: value });

  const blockOf = (slot: Slot) =>
    allocation.slots[slotKey(slot.soundId, slot.pitchShift)] ?? slot.suggestedBlock ?? '';
  const unassigned = slots.filter((s) => blockOf(s) === '').length;

  return (
    <div className="lit-settings">
      <label className="lit-row">
        <span>Placement side</span>
        <select value={options.side} onChange={(e) => set('side', e.target.value as PlacementSide)}>
          <option value="below">below the runner</option>
          <option value="above">above the runner</option>
          <option value="both">both (alternating)</option>
        </select>
      </label>
      <label className="lit-row" title="tp commands also fix yaw/pitch (playback builds); leave off while tuning in-game">
        <input
          type="checkbox"
          checked={options.includeRotation}
          onChange={(e) => set('includeRotation', e.target.checked)}
        />
        <span>Fix facing in tp commands</span>
      </label>
      <label className="lit-row" title="Multiply note velocity by instrument/track/group volumes, like playback">
        <input
          type="checkbox"
          checked={options.applyMixerVolumes}
          onChange={(e) => set('applyMixerVolumes', e.target.checked)}
        />
        <span>Apply mixer volumes</span>
      </label>
      <label className="lit-row">
        <span>Velocity curve α</span>
        <input
          type="number"
          min={0.5}
          max={4}
          step={0.1}
          value={options.alpha}
          onChange={(e) => set('alpha', Number(e.target.value) || 2)}
        />
      </label>
      <label className="lit-row" title="Runner line to the first track's note blocks">
        <span>First track depth</span>
        <input
          type="number"
          min={2}
          max={40}
          value={options.firstDepth}
          onChange={(e) => set('firstDepth', Math.max(2, Math.round(Number(e.target.value) || 2)))}
        />
      </label>
      <label className="lit-row" title="Vertical distance between consecutive track tiers">
        <span>Track spacing</span>
        <input
          type="number"
          min={3}
          max={12}
          value={options.spacing}
          onChange={(e) => set('spacing', Math.max(3, Math.round(Number(e.target.value) || 3)))}
        />
      </label>
      <label className="lit-row">
        <span>Palette region</span>
        <select
          value={options.paletteRegion}
          onChange={(e) => set('paletteRegion', e.target.value as PaletteRegionMode)}
        >
          <option value="song">sounds used by the song</option>
          <option value="full">entire allocation table</option>
          <option value="none">none</option>
        </select>
      </label>

      <div className="lit-config-head">
        <span>infinote mappings</span>
        <button type="button" onClick={onImportConfig} title="Seed the block table from your world's infinote.json">
          Import infinote.json
        </button>
      </div>
      {importStatus && <p className="lit-import-status">{importStatus}</p>}
      {slots.length === 0 ? (
        <p className="lit-slots-empty">
          All notes fit vanilla note blocks — no config needed.
        </p>
      ) : (
        <>
          <div className="lit-slot-table">
            <div className="lit-slot-row lit-slot-header">
              <span>sound</span>
              <span>shift</span>
              <span>notes</span>
              <span>base block</span>
            </div>
            {slots.map((slot) => {
              const key = slotKey(slot.soundId, slot.pitchShift);
              const value = blockOf(slot);
              return (
                <div key={key} className="lit-slot-row">
                  <span title={`${slot.soundId} (${slot.instrumentName})`}>{slot.soundId}</span>
                  <span>{slot.pitchShift > 0 ? `+${slot.pitchShift}` : slot.pitchShift}</span>
                  <span>{slot.count}</span>
                  <input
                    className={value === '' ? 'missing' : ''}
                    value={value}
                    placeholder="minecraft:…"
                    onChange={(e) => setSlotBlock(key, e.target.value)}
                    spellCheck={false}
                  />
                </div>
              );
            })}
          </div>
          {unassigned > 0 && (
            <p className="lit-slots-warning">
              {unassigned} slot{unassigned === 1 ? ' needs' : 's need'} a base block before export.
            </p>
          )}
        </>
      )}
    </div>
  );
}
