# DNW — Note Block DAW

A browser-based digital audio workstation for Minecraft note blocks, inspired
by [Open Note Block Studio](https://github.com/OpenNBS/NoteBlockStudio) —
with one goal the others don't have: exporting a song as a **playable in-game
structure** for [infinote](https://github.com/RS-256/infinote), a server-side
Fabric mod that extends note blocks with custom sounds, pitch shift and
volume control.

**▶ Live app: <https://rs-256.github.io/DNW/>** — runs entirely in the
browser, no install, no backend.

## Concepts

- **Tick**: the atomic time unit of a song. One tick = one Minecraft game
  tick (gt), so exporting to the game never drifts. Note blocks cannot
  sustain a sound, so every note is exactly one tick wide.
- **tps** (ticks per second): playback speed, derived as
  `tps = bpm / 60 * tickPerQuarter`, where `tickPerQuarter` is the number of
  game ticks per quarter note — the same setting infinote uses for its bpm.
- **Tempo track**: a non-deletable track that defines every bpm and
  time-signature change in the song.

## Features

### Editing & playback

- Piano roll with fixed one-tick-wide notes, per-note velocity / pan / fine
  pitch
- Unlimited tracks with per-track color, volume, pan, mute, solo, and track
  grouping
- Onion skin: inactive tracks are overlaid as translucent outlines in their
  track color, opacity scaled by note velocity
- Custom instruments: import `.ogg` samples, set base pitch / volume, and
  attach infinote sound ids (`namespace:path`)
- Skins: optional textured note rendering (note block texture fill,
  base-block border), toggleable as disabled / activated (active track only)
  / enabled

### Files

- Native projects (`.dnw.json`) with open / save
- NBS file support: reads v0–v5, writes v5
- MIDI import (`.mid` / `.midi`): note lengths are ignored — each note-on
  becomes one single-tick note (note blocks cannot sustain). MIDI has no
  gt/quarter concept, so an import modal asks for `tickPerQuarter`
  (default 8) and checks every event against the resulting game-tick grid:
  if the value would force rounding (e.g. 1/64 notes or triplets at 8), a
  red warning shows how many events are affected and suggests the smallest
  lossless value; importing anyway snaps those events to the nearest tick.
  One layer per MIDI track, tempo / time-signature changes go to the tempo
  track, and GM percussion (channel 10) maps to basedrum / snare / hat
- Autosave to IndexedDB — the last song is restored on launch
- Unified export modal: pick a format, reorder tracks by drag, include /
  exclude tracks per export

### Litematic export (infinote)

Renders a song as a *runner structure* schematic (`.litematic`): note blocks
laid out along a line, played back positionally while the listener is
teleported through it one block per game tick. Volume and pan are realized
**spatially** — velocity maps to each note block's distance from the
listener, computed in dB space.

- One track = one litematica region at its own depth; track depth is the
  author's fader, re-tunable in-game
- Tempo region: a command-block row that drives the listener (`tp` per tick,
  `/bpm set` at tempo changes), placed outside audible range
- Palette region: an auto-generated audition rack with wall-sign labels, one
  column per sound
- infinote config generation: a persistent allocation table maps
  `(sound, pitch shift)` to base blocks, seedable from your world's existing
  `infinote.json`; the export writes the full merged config
- Resource pack emission for custom `.ogg` samples (with a mono check —
  stereo sounds would play non-positionally)
- A markdown manifest: block / sound / pitch tables, track depths and a
  dB-error report as an in-game tuning reference
- Everything ships as a single zip (or a lone `.litematic` when nothing else
  is needed)

### WAV export

Renders the song to an audio file offline (`OfflineAudioContext`) with the
exact same node graph as in-app playback, so what you hear is what you get.

- Sample rate 44.1 / 48 kHz; bit depth 8 / 16 / 24 bit (integer PCM) or
  32 bit (integer or IEEE float)
- Checked tracks are always audible — mute/solo flags are ignored, volumes
  and pans still apply; loop settings are ignored (the song plays once)
- A mix peaking above full scale is attenuated as a whole instead of
  clipping (and the summary reports by how much); float output keeps its
  headroom unclipped

### MIDI export

Writes an SMF format-1 file (`.mid`): track 0 carries the tempo map (bpm and
time-signature changes), then one MIDI track per checked track. Game ticks
scale to a ~480 PPQ grid losslessly.

- Instruments map to General MIDI: one channel per instrument, vanilla
  defaults with sounding-octave transpose built in, editable per instrument
  in the Instruments dialog (stored in the project file);
  basedrum / snare / hat become GM drums on channel 10
- Note length is selectable — sustain until the next same-key note (capped
  at a quarter note, default) or a literal single game tick
- Velocity bakes in note × track × group volume; instrument volume becomes
  channel volume (CC7), track pan becomes channel pan (CC10)
- What MIDI cannot store is dropped with a warning: fine pitch (cents) and
  per-note pan

## Controls

| Input | Action |
| --- | --- |
| Left click (empty cell) | Add note |
| Left double-click (on note) | Delete note |
| Left drag (empty cell) | Box selection |
| Left drag (on note) | Move selection |
| Right click / right drag | Box selection (then copy / delete / bulk edit / fade via the side panel) |
| Ctrl+box selection | Add to the existing selection |
| Middle click | Park the playhead (playback starts from here) |
| Ctrl+click (on note) | Toggle note selection |
| Wheel / Shift+wheel | Scroll vertically / horizontally |
| Ctrl+wheel | Zoom (notes stay square) |
| Space | Play from the playhead / stop |
| ⏮ button | Play from the beginning |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+A / C / X / V | Select all / copy / cut / paste |
| Delete | Delete selection |
| Click on tempo lane | Add / edit bpm & time-signature events |

## Getting sounds and textures

Minecraft assets are **not** bundled; they are fetched on first use and
cached locally in IndexedDB:

- **Sounds** — vanilla note block samples load automatically from the
  community mirror
  [`InventivetalentDev/minecraft-assets`](https://github.com/InventivetalentDev/minecraft-assets)
  via jsDelivr (Mojang's own object store sends no CORS header).
- **Textures** (for skins) — set the `skin` dropdown to `activated` or
  `enabled`, then click **Get textures** to download the client jar from
  `piston-data.mojang.com`, or drop a Minecraft client `.jar` onto the
  button.

Both hosts send `Access-Control-Allow-Origin: *`, so no proxy is needed in
dev or on static hosting. Override the hosts with `VITE_MC_SOUND_BASE` /
`VITE_MC_DATA_BASE`.

## Roadmap

- Live connection to a server (WebSocket / RCON) for auditioning without
  exporting
- Datapack export
- Automatic stereo→mono downmix for custom samples
- Desktop packaging via Tauri

## Development

```sh
npm install
npm run dev     # start the dev server
npm test        # run unit tests
npm run lint    # lint
```

### Architecture

Dependencies flow one way: `ui → state → core`.

- `src/core` — UI-agnostic domain logic (data model, NBS / MIDI I/O, audio engine,
  litematic / NBT writer, infinote placement & config, platform adapters).
  Must not import React or the upper layers; enforced by ESLint.
- `src/state` — zustand stores, undo/redo history (immer patches).
- `src/ui` — React components, canvas piano roll, export modal.

## Deployment (GitHub Pages)

Pushing to `main` builds and deploys the app via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). One-time
setup: enable Pages under *Settings → Pages → Build and deployment → Source →
GitHub Actions*. That's it — sounds and textures work out of the box.

The production `base` path is `/DNW/` (set in `vite.config.ts`); if you fork
under a different repo name, update it to `/<repo>/`.
