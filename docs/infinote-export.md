# infinote Export — Design Notes (future work)

Goal: play DNW songs inside Minecraft through
[infinote](https://github.com/RS-256/infinote), a server-side Fabric mod that
maps custom sounds onto note blocks with pitch shift and volume control.

Nothing in this document is implemented yet. The v1 data model was designed
so that all of the following can be added under `src/core/infinote/` without
touching the rest of the app.

## What the model already provides

- `Song.tickPerQuarter` — game ticks per quarter note, the same unit infinote
  uses for its bpm setting. A song's `TempoMap` yields tps for any tick.
- `Note.tick` — 1 tick = 1 game tick, so note timing maps to redstone delay
  without rounding.
- `Instrument.soundId` — the infinote sound id (`namespace:path`) entered in
  the Instruments dialog.
- `Instrument.baseBlock` — the block placed under the note block. Vanilla
  instruments default to their canonical blocks (see `VANILLA_BASE_BLOCKS`).
- `Note.velocity` / `Note.pan` / `Note.pitch` — map to infinote's volume and
  pitchShift parameters (pan would be positional in-game).

## Planned outputs

### 1. Resource pack generation

A zip containing:

```
pack.mcmeta
assets/<namespace>/sounds.json
assets/<namespace>/sounds/<path>.ogg   (from IndexedDB sample store)
```

`sounds.json` entries come from each custom instrument's `soundId`. Vanilla
instruments need no pack entries.

### 2. `/infinote add` command sequences

For server setup, one command per instrument:

```
/infinote add <baseBlock> <soundId> <category> <pitchShift> <volume>
```

`pitchShift` derives from `Instrument.pitchKey` relative to the vanilla
anchor (45 = F#4). Exported as a plain text file (one command per line) or a
datapack function.

### 3. Litematic export (primary goal)

Render the song as a note block contraption schematic (`.litematic`) that
plays as-is on an infinote server.

- **Blocked on**: sample `.litematic` files from the project owner, which
  will define the target contraption layout (timing bus, block placement
  conventions). Parse format first (NBT + bit-packed block states), then
  generate.
- Timing: song ticks are already game ticks. bpm changes on the tempo track
  translate to repeater delays / timer circuit configuration; `tickPerQuarter`
  ties the musical grid to the redstone grid.
- Each note becomes a note block (tuned to `Note.key`, note blocks natively
  cover keys 33-57; out-of-range keys need infinote pitch-shifted sounds)
  placed on its instrument's `baseBlock`.

### 4. Live connection (later)

WebSocket bridge or RCON from the app to a running server for audition
without exporting. Requires either a companion mod endpoint in infinote or
RCON access; design TBD.
