/**
 * General MIDI mapping for MIDI export.
 *
 * Every instrument resolves to a MidiVoice: either a melodic GM program with
 * an octave transpose (correcting for the note block sample's sounding
 * octave), or a fixed key on the GM percussion channel. Vanilla defaults live
 * here; the user can override the program per instrument via
 * Instrument.midiProgram (custom instruments default to piano).
 */
import type { Instrument, VanillaInstrumentId } from '../model/types';

/** GM percussion channel (0-based). */
export const DRUM_CHANNEL = 9;

/** GM program names, index = program number. */
export const GM_PROGRAM_NAMES: readonly string[] = [
  'Acoustic Grand Piano',
  'Bright Acoustic Piano',
  'Electric Grand Piano',
  'Honky-tonk Piano',
  'Electric Piano 1',
  'Electric Piano 2',
  'Harpsichord',
  'Clavinet',
  'Celesta',
  'Glockenspiel',
  'Music Box',
  'Vibraphone',
  'Marimba',
  'Xylophone',
  'Tubular Bells',
  'Dulcimer',
  'Drawbar Organ',
  'Percussive Organ',
  'Rock Organ',
  'Church Organ',
  'Reed Organ',
  'Accordion',
  'Harmonica',
  'Tango Accordion',
  'Acoustic Guitar (nylon)',
  'Acoustic Guitar (steel)',
  'Electric Guitar (jazz)',
  'Electric Guitar (clean)',
  'Electric Guitar (muted)',
  'Overdriven Guitar',
  'Distortion Guitar',
  'Guitar Harmonics',
  'Acoustic Bass',
  'Electric Bass (finger)',
  'Electric Bass (pick)',
  'Fretless Bass',
  'Slap Bass 1',
  'Slap Bass 2',
  'Synth Bass 1',
  'Synth Bass 2',
  'Violin',
  'Viola',
  'Cello',
  'Contrabass',
  'Tremolo Strings',
  'Pizzicato Strings',
  'Orchestral Harp',
  'Timpani',
  'String Ensemble 1',
  'String Ensemble 2',
  'Synth Strings 1',
  'Synth Strings 2',
  'Choir Aahs',
  'Voice Oohs',
  'Synth Voice',
  'Orchestra Hit',
  'Trumpet',
  'Trombone',
  'Tuba',
  'Muted Trumpet',
  'French Horn',
  'Brass Section',
  'Synth Brass 1',
  'Synth Brass 2',
  'Soprano Sax',
  'Alto Sax',
  'Tenor Sax',
  'Baritone Sax',
  'Oboe',
  'English Horn',
  'Bassoon',
  'Clarinet',
  'Piccolo',
  'Flute',
  'Recorder',
  'Pan Flute',
  'Blown Bottle',
  'Shakuhachi',
  'Whistle',
  'Ocarina',
  'Lead 1 (square)',
  'Lead 2 (sawtooth)',
  'Lead 3 (calliope)',
  'Lead 4 (chiff)',
  'Lead 5 (charang)',
  'Lead 6 (voice)',
  'Lead 7 (fifths)',
  'Lead 8 (bass + lead)',
  'Pad 1 (new age)',
  'Pad 2 (warm)',
  'Pad 3 (polysynth)',
  'Pad 4 (choir)',
  'Pad 5 (bowed)',
  'Pad 6 (metallic)',
  'Pad 7 (halo)',
  'Pad 8 (sweep)',
  'FX 1 (rain)',
  'FX 2 (soundtrack)',
  'FX 3 (crystal)',
  'FX 4 (atmosphere)',
  'FX 5 (brightness)',
  'FX 6 (goblins)',
  'FX 7 (echoes)',
  'FX 8 (sci-fi)',
  'Sitar',
  'Banjo',
  'Shamisen',
  'Koto',
  'Kalimba',
  'Bag pipe',
  'Fiddle',
  'Shanai',
  'Tinkle Bell',
  'Agogo',
  'Steel Drums',
  'Woodblock',
  'Taiko Drum',
  'Melodic Tom',
  'Synth Drum',
  'Reverse Cymbal',
  'Guitar Fret Noise',
  'Breath Noise',
  'Seashore',
  'Bird Tweet',
  'Telephone Ring',
  'Helicopter',
  'Applause',
  'Gunshot',
];

/** How one instrument is voiced in the exported MIDI file. */
export interface MidiVoice {
  /** GM program 0-127. Meaningless when drumKey is set. */
  program: number;
  /** Semitones added on top of key + 21 (sounding-octave correction). */
  transpose: number;
  /** GM percussion key; the note plays this key on channel 10 instead. */
  drumKey?: number;
}

interface VanillaVoice {
  program: number;
  transpose: number;
}

/**
 * Vanilla melodic defaults. Transposes mirror the note block sounding
 * octaves (bass/didgeridoo two octaves down, flute/cow bell one up, the
 * mallet/bell family two up).
 */
const VANILLA_MELODIC: Partial<Record<VanillaInstrumentId, VanillaVoice>> = {
  harp: { program: 0, transpose: 0 },
  pling: { program: 4, transpose: 0 },
  iron_xylophone: { program: 11, transpose: 0 },
  bit: { program: 80, transpose: 0 },
  banjo: { program: 105, transpose: 0 },
  guitar: { program: 24, transpose: -12 },
  bass: { program: 32, transpose: -24 },
  didgeridoo: { program: 87, transpose: -24 },
  flute: { program: 73, transpose: 12 },
  cow_bell: { program: 113, transpose: 12 },
  bell: { program: 9, transpose: 24 },
  chime: { program: 14, transpose: 24 },
  xylophone: { program: 13, transpose: 24 },
};

/** Vanilla percussion: fixed GM drum keys on channel 10. */
const VANILLA_DRUMS: Partial<Record<VanillaInstrumentId, number>> = {
  basedrum: 35, // Acoustic Bass Drum
  snare: 38, // Acoustic Snare
  hat: 42, // Closed Hi-hat
};

export function isDrumInstrument(instrument: Instrument): boolean {
  return instrument.vanillaId !== undefined && VANILLA_DRUMS[instrument.vanillaId] !== undefined;
}

/** Default GM program for an instrument, before any midiProgram override. */
export function defaultProgram(instrument: Instrument): number {
  return (instrument.vanillaId && VANILLA_MELODIC[instrument.vanillaId]?.program) ?? 0;
}

export function midiVoiceFor(instrument: Instrument): MidiVoice {
  if (instrument.vanillaId) {
    const drumKey = VANILLA_DRUMS[instrument.vanillaId];
    if (drumKey !== undefined) return { program: 0, transpose: 0, drumKey };
    const melodic = VANILLA_MELODIC[instrument.vanillaId];
    if (melodic) {
      return { program: instrument.midiProgram ?? melodic.program, transpose: melodic.transpose };
    }
  }
  return { program: instrument.midiProgram ?? 0, transpose: 0 };
}
