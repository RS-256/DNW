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
  writeManifest: boolean;
}

export const DEFAULT_LITEMATIC_OPTIONS: LitematicUiOptions = {
  side: 'below',
  includeRotation: false,
  applyMixerVolumes: true,
  alpha: 2,
  firstDepth: 2,
  spacing: 3,
  paletteRegion: 'song',
  writeManifest: true,
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
      <label
        className="lit-row"
        title="Which side of the runner the tracks occupy. Above and below sound identical — existing builds use below by visual convention; 'both' alternates tracks between the two sides."
      >
        <span>Placement side</span>
        <select value={options.side} onChange={(e) => set('side', e.target.value as PlacementSide)}>
          <option value="below">below the runner</option>
          <option value="above">above the runner</option>
          <option value="both">both (alternating)</option>
        </select>
      </label>
      <label
        className="lit-row"
        title="Append yaw/pitch to every tp so the stereo field is locked during playback. Leave off for tuning sessions, where you may want to look sideways to audition volumes."
      >
        <input
          type="checkbox"
          checked={options.includeRotation}
          onChange={(e) => set('includeRotation', e.target.checked)}
        />
        <span>Fixed facing in tp commands</span>
      </label>
      <label
        className="lit-row"
        title="Multiply note velocity by instrument/track/group volumes, like playback does. Turn off if track loudness is tuned purely by layer depth in-game."
      >
        <input
          type="checkbox"
          checked={options.applyMixerVolumes}
          onChange={(e) => set('applyMixerVolumes', e.target.checked)}
        />
        <span>Apply mixer volumes</span>
      </label>
      <label
        className="lit-row"
        title="Velocity→loudness curve exponent. 2 ≈ the usual MIDI feel; higher pushes quiet notes further out (stronger dynamics), 1 is linear."
      >
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
      <label
        className="lit-row"
        title="Blocks from the runner line down to the first track's note blocks. Larger = the whole song plays quieter (top track gain cap 1 − depth/48)."
      >
        <span>First track depth</span>
        <input
          type="number"
          min={2}
          max={40}
          value={options.firstDepth}
          onChange={(e) => set('firstDepth', Math.max(2, Math.round(Number(e.target.value) || 2)))}
        />
      </label>
      <label
        className="lit-row"
        title="Vertical distance between consecutive track tiers. 3 = tiers touch (base/note block/air); raise it to spread tracks further apart in volume."
      >
        <span>Track spacing</span>
        <input
          type="number"
          min={3}
          max={12}
          value={options.spacing}
          onChange={(e) => set('spacing', Math.max(3, Math.round(Number(e.target.value) || 3)))}
        />
      </label>
      <label
        className="lit-row"
        title="Write a markdown reference sheet (block/sound/pitch tables, track depths, dB errors)"
      >
        <input
          type="checkbox"
          checked={options.writeManifest}
          onChange={(e) => set('writeManifest', e.target.checked)}
        />
        <span>Write manifest (.md)</span>
      </label>
      <label
        className="lit-row"
        title="Include a sample rack beside the song start: one labeled column per sound, variants stacked by pitch shift. Use it in-game to audition sounds and as a mapping reference."
      >
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

      <div
        className="lit-config-head"
        title="Notes outside the vanilla 2-octave range (and custom sounds) each need a base block registered in infinote.json. Assignments are remembered across exports."
      >
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
              <span title="infinote sound id">sound</span>
              <span title="Pitch shift in semitones (fraction = cents)">shift</span>
              <span title="Notes in the song using this slot">notes</span>
              <span title="Block placed under the note block; written to infinote.json">
                base block
              </span>
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
