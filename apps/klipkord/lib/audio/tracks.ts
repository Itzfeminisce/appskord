// Bundled music, made by scripts/make-music.mjs (CC0). Names and moods are the MusicPicker frame's.
export type Mood = 'Bright' | 'Calm' | 'Driving';
/** ms: the bundled file's length, so the picker shows it before the file loads. */
export interface Track { id: string; name: string; mood: Mood; about: string; file: string; ms: number }

export const MOODS: Mood[] = ['Bright', 'Calm', 'Driving'];

export const TRACKS: Track[] = [
  { id: 'bright-morning', name: 'Bright morning', mood: 'Bright', about: 'Bright · light piano and plucks', file: '/music/bright-morning.m4a', ms: 150_000 },
  { id: 'night-drive', name: 'Night drive', mood: 'Driving', about: 'Driving · synths', file: '/music/night-drive.m4a', ms: 164_000 },
  { id: 'slow-tide', name: 'Slow tide', mood: 'Calm', about: 'Calm · pads', file: '/music/slow-tide.m4a', ms: 185_000 },
  { id: 'paper-planes', name: 'Paper planes', mood: 'Bright', about: 'Bright · ukulele', file: '/music/paper-planes.m4a', ms: 118_000 },
];
