/**
 * Note block style pitch: samples are resampled, so pitch shift is just a
 * playback-rate change of 2^(semitones/12) relative to the instrument's
 * base key (45 = F#4 for vanilla note blocks).
 */
export function keyToPlaybackRate( key: number, pitchKey: number, fineCents = 0 ): number {
  return Math.pow( 2, ( key + fineCents / 100 - pitchKey ) / 12 )
}
