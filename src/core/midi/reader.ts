/**
 * Standard MIDI File (SMF) reader for the importer.
 *
 * Reads formats 0/1 (format 2 tracks are treated as simultaneous). Only what
 * the importer needs is collected: note-on events (note lengths are
 * meaningless for note blocks, which cannot sustain), tempo and
 * time-signature meta events, and track names. Times stay in MIDI ticks;
 * conversion to game ticks happens in convert.ts once the user has chosen
 * tickPerQuarter in the import modal.
 */

export interface MidiNote {
  /** Time in MIDI ticks (units of 1/ppq quarter notes). */
  tick: number;
  /** MIDI note number 0-127 (69 = A4). */
  key: number;
  /** 1-127 (velocity-0 note-ons are note-offs and are dropped). */
  velocity: number;
  /** 0-15; channel 9 is the GM percussion channel. */
  channel: number;
  /** Source track index. */
  track: number;
}

export interface MidiTempo {
  tick: number;
  bpm: number;
}

export interface MidiTimeSignature {
  tick: number;
  numerator: number;
  denominator: number;
}

export interface MidiFile {
  format: number;
  /** MIDI ticks per quarter note (the header division). */
  ppq: number;
  trackCount: number;
  /** Every note-on across all tracks, sorted by tick. */
  notes: MidiNote[];
  tempos: MidiTempo[];
  timeSignatures: MidiTimeSignature[];
  /** First track-name meta event of each track, by track index. */
  trackNames: (string | undefined)[];
}

export function readMidi(buffer: ArrayBuffer): MidiFile {
  const view = new DataView(buffer);
  const decoder = new TextDecoder('latin1');
  let pos = 0;

  const u8 = (): number => {
    if (pos >= view.byteLength) throw new Error('Unexpected end of MIDI file');
    return view.getUint8(pos++);
  };
  const u16 = (): number => {
    const v = view.getUint16(pos);
    pos += 2;
    return v;
  };
  const u32 = (): number => {
    const v = view.getUint32(pos);
    pos += 4;
    return v;
  };
  const fourcc = (): string => {
    const s = decoder.decode(new Uint8Array(buffer, pos, 4));
    pos += 4;
    return s;
  };
  /** MIDI variable-length quantity (7 bits per byte, high bit = continue). */
  const varlen = (): number => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = u8();
      v = (v << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) return v;
    }
    throw new Error('Invalid variable-length quantity in MIDI file');
  };

  if (buffer.byteLength < 14 || fourcc() !== 'MThd') {
    throw new Error('Not a MIDI file (missing MThd header)');
  }
  const headerLength = u32();
  const format = u16();
  const trackCount = u16();
  const division = u16();
  pos += headerLength - 6; // tolerate oversized headers
  if ((division & 0x8000) !== 0) {
    throw new Error('SMPTE time division is not supported');
  }
  const ppq = division;
  if (ppq === 0) throw new Error('Invalid MIDI time division (0 ticks per quarter)');

  const notes: MidiNote[] = [];
  const tempos: MidiTempo[] = [];
  const timeSignatures: MidiTimeSignature[] = [];
  const trackNames: (string | undefined)[] = [];

  for (let track = 0; track < trackCount && pos + 8 <= view.byteLength; track++) {
    const id = fourcc();
    const length = u32();
    const end = Math.min(pos + length, view.byteLength);
    if (id !== 'MTrk') {
      pos = end; // skip alien chunks (allowed by the spec)
      track--;
      continue;
    }

    let tick = 0;
    let runningStatus = 0;
    while (pos < end) {
      tick += varlen();
      let status = u8();
      if (status < 0x80) {
        // Data byte: reuse the running status.
        if (runningStatus === 0) throw new Error('MIDI data byte without a status byte');
        pos -= 1;
        status = runningStatus;
      } else if (status < 0xf0) {
        runningStatus = status;
      } else {
        runningStatus = 0; // system messages cancel running status
      }

      if (status === 0xff) {
        const type = u8();
        const dataLength = varlen();
        const dataStart = pos;
        if (type === 0x51 && dataLength >= 3) {
          const usPerQuarter = (u8() << 16) | (u8() << 8) | u8();
          if (usPerQuarter > 0) tempos.push({ tick, bpm: 60_000_000 / usPerQuarter });
        } else if (type === 0x58 && dataLength >= 2) {
          const numerator = u8();
          const denominator = 2 ** u8();
          if (numerator > 0) timeSignatures.push({ tick, numerator, denominator });
        } else if (type === 0x03 && trackNames[track] === undefined) {
          trackNames[track] = decoder
            .decode(new Uint8Array(buffer, pos, Math.min(dataLength, end - pos)))
            .trim();
        }
        pos = dataStart + dataLength;
      } else if (status === 0xf0 || status === 0xf7) {
        pos += varlen(); // sysex: skip payload
      } else {
        const kind = status & 0xf0;
        const channel = status & 0x0f;
        const data1 = u8();
        if (kind !== 0xc0 && kind !== 0xd0) {
          const data2 = u8();
          if (kind === 0x90 && data2 > 0) {
            notes.push({ tick, key: data1, velocity: data2, channel, track });
          }
        }
      }
    }
    pos = end;
  }

  notes.sort((a, b) => a.tick - b.tick);
  tempos.sort((a, b) => a.tick - b.tick);
  timeSignatures.sort((a, b) => a.tick - b.tick);

  return { format, ppq, trackCount, notes, tempos, timeSignatures, trackNames };
}
