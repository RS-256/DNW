# DNW — Note Block DAW

A digital audio workstation for Minecraft note blocks, heavily inspired by
[Open Note Block Studio](https://github.com/OpenNBS/NoteBlockStudio).

The end goal of this project is in-game music through
[infinote](https://github.com/RS-256/infinote), a server-side Fabric mod that
extends note blocks with custom sounds, pitch shift and volume control.

## Concepts

- **Tick**: the atomic time unit of a song. One tick = one Minecraft game tick
  (gt), so exporting to the game never drifts. Note blocks cannot sustain a
  sound, so every note is exactly one tick wide.
- **tps** (ticks per second): playback speed, derived as
  `tps = bpm / 60 * tickPerQuarter`, where `tickPerQuarter` is the number of
  game ticks per quarter note — the same setting infinote uses for its bpm.
- **Tempo track**: a non-deletable track that defines every bpm and
  time-signature change in the song.

## Features (v1 scope)

- Piano roll with fixed one-tick-wide notes, per-note velocity / pan / fine pitch
- Unlimited tracks with per-track color, volume, pan, mute, solo
- Onion skin: inactive tracks are overlaid as translucent outlines in their
  track color, opacity scaled by note velocity
- Custom instruments: import .ogg samples, set base pitch / volume, and attach
  infinote sound ids (`namespace:path`)
- NBS file support: reads v0–v5, writes v5
- Skins: optional textured note rendering (note block texture fill, base-block
  border), toggleable as disabled / activated (active track only) / enabled

## Roadmap

- **infinote-compatible litematic export** — render a song as a note block
  contraption schematic (.litematic) that plays as-is on an infinote server
  (design notes: [docs/infinote-export.md](docs/infinote-export.md))
- infinote resource pack generation (`sounds.json` + .ogg) and
  `/infinote add` command sequences
- Live connection to a server (WebSocket / RCON)
- MIDI import, datapack export
- Desktop packaging via Tauri

## Status

All v1 features above are implemented. See the Roadmap for what comes next.

- Open / save native projects (`.dnw.json`), import / export `.nbs`
- Autosave to IndexedDB (the last song is restored on launch)
- Custom instruments: drop `.ogg` files into the Instruments dialog
- Skins: set the `skin` dropdown to `activated` or `enabled`, then click
  "Get textures" (downloads block textures from Mojang's CDN once and caches
  them locally; you can also drop a Minecraft client `.jar` onto the button)

### Controls

| Input | Action |
| --- | --- |
| Left click (empty cell) | Add note |
| Left drag (empty cell) | Box selection |
| Left drag (on note) | Move selection |
| Right click / right drag | Box selection (then copy / delete / bulk edit / fade via the side panel) |
| Middle click | Park the playhead (playback starts from here) |
| Ctrl+click | Toggle note selection |
| Wheel / Shift+wheel | Scroll vertically / horizontally |
| Ctrl+wheel | Zoom (notes stay square) |
| Space | Play from the playhead / stop |
| ⏮ button | Play from the beginning |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+A / C / X / V | Select all / copy / cut / paste |
| Delete | Delete selection |
| Click on tempo lane | Add / edit bpm & time-signature events |

## Development

```sh
npm install
npm run dev     # start the dev server
npm test        # run unit tests
npm run lint    # lint
```

### Architecture

Dependencies flow one way: `ui → state → core`.

- `src/core` — UI-agnostic domain logic (data model, NBS I/O, audio engine,
  platform adapters). Must not import React or the upper layers; enforced by
  ESLint.
- `src/state` — zustand stores, undo/redo history (immer patches).
- `src/ui` — React components, canvas piano roll.

Minecraft assets (sounds, textures) are **not** bundled; they are fetched from
Mojang's official CDN on first use and cached locally in IndexedDB.

### Asset proxy note

Mojang's binary CDNs (`resources.download.minecraft.net` for sounds,
`piston-data.mojang.com` for the client jar) send no CORS headers, so the
browser cannot fetch them directly. The dev server proxies them as `/mc-res`
and `/mc-data` (see `vite.config.ts`). Production hosting needs equivalent
rewrites (e.g. Netlify/Vercel proxy rules); a future Tauri build can fetch
directly since it is not subject to CORS. As a fallback, block textures can
also be imported by dropping a Minecraft client `.jar` onto the
"Get textures" button.
