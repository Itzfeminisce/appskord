// Side panel v3 copy, verbatim from the HomeV3, WhatsNewV3, LookLock, LookBible, MakingMotion, TemplatesListV3 and
// LibraryV3 frames. Pipeline strings (key frames, motion) come from lib/pipeline/v3/states.

export const HOME = {
  newBadge: 'NEW IN MOTIKORD 3',
  newTitle: 'Motion that looks made today',
  newLine: 'Depth, camera moves and kinetic type.',
  seeWhatsNew: 'See what’s new',
  prompt: 'What should the clip show?',
  yourMedia: 'Your media',
  attached: 'Attached',
  clipType: 'Clip type',
  detected: 'Detected',
  look: 'Look',
  style: 'Style',
  lookGuide: 'Look guide',
  startsAs: 'Starts as',
  length: 'Length',
  auto: 'Auto',
  upTo: 'up to 60 s',
  sizes: 'Every clip comes in all three sizes. This one opens first.',
  make: 'Make clip',
  startFromTemplate: 'Start from a template',
  recent: 'Recent clips',
  seeAll: 'See all',
  v2Made: 'made with v2',
  readyMade: 'ready-made clips in 8 looks',
} as const;

export const WHATS_NEW = {
  title: 'What’s new',
  badge: 'MOTIKORD 3',
  heading: 'What’s new in Motikord 3',
  line: 'Clips that move like they were made today. Still free, still on this computer.',
  items: [
    { title: 'Check the key frames', line: 'Approve one still per scene before any motion is added. No AI cost.' },
    { title: 'Look guide', line: 'Palette, type, motion feel, light and texture, kept in every scene. Your brand kit still wins.' },
    { title: 'Motion that feels made', line: 'Springs, kinetic type, camera moves and depth. Each part lands just after the last.' },
    { title: 'Effects, animations and 3D', line: 'Glass, glow, depth of field, ready-made animations, particles and 3D text.' },
    { title: 'Captions and voice', line: 'Auto captions and AI voiceover with your own Groq or OpenAI key.', tag: 'Off by default' },
  ],
  v2: 'Your v2 clips keep their look. Open one and choose “Restyle with v3 motion”.',
  make: 'Make a clip',
} as const;

export const LOOK_LOCK = {
  kicker: 'Look lock',
  sceneLine: (n: number, seconds: number, pack: string) => `${n} scenes · ${seconds} s · ${pack}`,
  changeLook: 'Change the look',
  cancel: 'Cancel',
} as const;

export const LOOK_BIBLE = {
  title: 'Look guide',
  line: 'One set of rules every scene follows.',
  close: 'Close',
  closeBack: 'Close and go back',
  livePreview: 'Live preview',
  liveLine: 'Changes show here as you make them.',
  palette: 'Palette',
  fromPack: (pack: string) => `From pack: ${pack}`,
  roles: ['Ground', 'Ink', 'Glow', 'Panel', 'Muted'],
  typePair: 'Type pair',
  heading: 'Heading',
  body: 'Body',
  weightMoves: 'Weight moves',
  weightFrom: 'Headings grow from',
  weightLight: 'light',
  weightTo: 'to',
  weightHeavy: 'heavy',
  weightEnter: 'as they enter',
  feel: 'Motion feel',
  feels: ['Smooth', 'Snappy', 'Bouncy', 'Steady', 'Floaty'],
  light: 'Light',
  softness: 'Softness',
  texture: 'Texture',
  grain: 'Grain',
  grains: ['Off', 'Fine', 'Film'],
  glow: 'Glow',
  camera: 'Camera habit',
  cameras: ['Hold', 'Gentle push', 'Lively'],
  brandWins: 'Your brand kit still wins: colours, fonts and logo.',
  nameIt: 'Name this guide',
  save: 'Save as a look guide',
  use: 'Use for this clip',
  yours: 'Your look guides',
} as const;

export const MAKING = {
  openNow: 'Open the editor now',
  cancel: 'Cancel',
  opening: 'Opening the editor',
  openingLine: 'Export renders every frame at full quality. A slower computer takes longer, never looks worse.',
  fps: '60 fps',
  finishing: 'Finishing on',
  progress: 'Key frames approved',
} as const;

export const TEMPLATES = {
  title: 'Templates',
  line: 'Each keeps its look. Your brand kit swaps in colours, fonts and logo.',
  type: 'Type',
  style: (name: string) => `STYLE · ${name.toUpperCase()}`,
  any: 'Any',
  newInV3: 'New in v3',
  count: (n: number) => `${n} templates`,
  tap: 'Tap one to open your own copy',
} as const;

export const LIBRARY = {
  title: 'Your clips',
  count: (n: number) => `${n} clips`,
  show: 'Show',
  filters: ['All', 'v3', 'v2 look'],
  v2: 'v2 look',
  restyle: 'Restyle with v3 motion',
  restyled: 'Restyled · v2 version in Changes',
  edited: (days: number) => `Edited ${days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}`,
  footer: 'Clips stay on this computer. A v2 clip keeps its look until you restyle it.',
} as const;
