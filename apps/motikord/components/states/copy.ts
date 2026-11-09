// StatesV3 copy, verbatim from the frame. The eight pipeline states keep their one source in lib/pipeline/v3/states;
// restyle-failed keeps its one in lib/restyle.
import { RESTYLE } from '../../lib/restyle/restyle';
import { stateCopy, type PipelineStateId } from '../../lib/pipeline/v3/states';

export const STATE_IDS = [
  'keyframe-failed', 'keyframes-waiting', 'motion-failed', 'animate-layer-failed', 'animate-layer-unclear',
  'captions-failed', 'captions-no-key', 'captions-no-voice', 'voiceover-failed', 'voiceover-no-key', 'restyle-failed',
  'critic-not-available', 'critic-fix-limit', 'critic-ai-failed', 'preview-light', 'effect-heavy',
  'three-d-unavailable', 'lottie-credit', 'rig-photo', 'data-paste-failed', 'look-guide-saved', 'export-60-fallback',
] as const;
export type StateId = (typeof STATE_IDS)[number];

export interface StateParams {
  /** From 1. */
  scene?: number;
  /** "Groq". */
  provider?: string;
  /** The look guide's name. */
  name?: string;
}
export interface StateView {
  id: StateId;
  title: string;
  line: string;
  action?: string;
  /** A second button beside the first (captions-no-key: Paste a key instead). */
  action2?: string;
  /** "error" for a failure, "notice" for a heads-up, "done" for good news. */
  tone: 'error' | 'notice' | 'done';
}

/** Where each state shows, as the frame labels it. */
export const WHERE: Readonly<Record<StateId, string>> = {
  'keyframe-failed': 'Check the key frames, scene 3',
  'keyframes-waiting': 'Check the key frames',
  'motion-failed': 'Making the motion',
  'animate-layer-failed': 'Editor, Layer · Animate this layer',
  'animate-layer-unclear': 'Editor, Layer · Animate this layer',
  'captions-failed': 'Editor, Captions',
  'captions-no-key': 'Editor, Captions',
  'captions-no-voice': 'Editor, Captions',
  'voiceover-failed': 'Editor, Voiceover',
  'voiceover-no-key': 'Editor, Voiceover',
  'restyle-failed': 'Restyle with v3 motion',
  'critic-not-available': 'Quality check',
  'critic-fix-limit': 'Quality check, scene 2',
  'critic-ai-failed': 'Quality check',
  'preview-light': 'Editor, stage',
  'effect-heavy': 'Editor, Scene · Effects',
  'three-d-unavailable': 'Editor, Layer · 3D',
  'lottie-credit': 'Assets, after adding an animation',
  'rig-photo': 'Editor, Layer · Rig',
  'data-paste-failed': 'Editor, Scene · Chart data',
  'look-guide-saved': 'Look guide, toast',
  'export-60-fallback': 'Export',
};

export const CHROME_3D_URL = 'chrome://settings/system';
export const THREE_D_OPENS = 'Opens';
/** The sample scene the frame shows for the states that name one. */
const SAMPLE_SCENE: Partial<Record<StateId, number>> = { 'keyframe-failed': 3, 'motion-failed': 4, 'critic-fix-limit': 2 };

const PIPELINE = new Set<string>(['keyframe-failed', 'keyframes-waiting', 'motion-failed', 'animate-layer-failed', 'animate-layer-unclear', 'critic-not-available', 'critic-ai-failed', 'critic-fix-limit']);

/** The copy for one state. */
export function stateView(id: StateId, v: StateParams = {}): StateView {
  const scene = v.scene ?? SAMPLE_SCENE[id] ?? 1;
  if (PIPELINE.has(id)) {
    const c = stateCopy(id as PipelineStateId, { scene, provider: v.provider });
    return { id, title: c.title, line: c.line, action: c.action, tone: id === 'keyframes-waiting' ? 'notice' : 'error' };
  }
  const make = (title: string, line: string, action?: string, tone: StateView['tone'] = 'error'): StateView => ({ id, title, line, action, tone });
  switch (id) {
    case 'captions-failed': return make('Your narration couldn’t be written down', 'Your clip is fine and plays without captions. Try again to add them.', 'Try again');
    case 'captions-no-key': return { ...make('Auto captions need a Groq or OpenAI key', 'Only your narration goes to it, to be written down. Your clip works fine without captions.', 'Connect Penv Cloud'), action2: 'Paste a key instead' };
    case 'captions-no-voice': return make('No speech found in the narration', 'Your clip is unchanged. Captions appear once the narration has someone speaking.', 'Choose narration');
    case 'voiceover-failed': return make('Your voiceover wasn’t made', 'Your script is kept as written. Try again to make the voice.', 'Try again');
    case 'voiceover-no-key': return make('AI voiceover needs an OpenAI key', 'Only your script goes to OpenAI. Your clip works fine without a voice.', 'Add an OpenAI key');
    case 'restyle-failed': return make(RESTYLE.failed.title, RESTYLE.failed.line, RESTYLE.failed.action);
    case 'preview-light': return make('Preview is lighter on this computer', 'Export renders every frame at full quality. A slower computer takes longer, never looks worse.', undefined, 'notice');
    case 'effect-heavy': return make('This scene has many effects', 'Its preview drops to light so it plays smoothly. Export is always full quality.', undefined, 'notice');
    case 'three-d-unavailable': return make('Chrome has 3D graphics turned off', '3D layers show flat in preview and export. Everything else is unchanged. Turn on “Use graphics acceleration when available” in Chrome to get depth back.', 'How to turn it on', 'notice');
    case 'lottie-credit': return make('Credit added to Credits', 'This animation’s maker is named in your clip’s Credits. Nothing to do.', undefined, 'done');
    case 'rig-photo': return make('Photos can’t be rigged', 'Your photo stays as it is. Rigs work on shapes, so use a shape to give it bones.', 'Use a shape', 'notice');
    case 'data-paste-failed': return make('Motikord couldn’t read the pasted table', 'Your chart keeps its numbers. Paste again with one label and one number per row.', 'Paste again');
    case 'look-guide-saved': return make('Saved as a look guide', `“${v.name ?? 'Morning shift'}” is ready for your next clip. Brand kit still wins on colours, fonts, logo.`, undefined, 'done');
    case 'export-60-fallback': return make('Exporting at 30 fps', '60 fps would take too long on this computer. Every frame is still full quality.', 'Export at 60 anyway', 'notice');
    default: throw new Error(`Motikord: no copy for state ${id}`);
  }
}

/** Each state with the frame's sample values, for the StatesV3 screen and tests. */
export const STATES = Object.fromEntries(STATE_IDS.map((id) => [id, stateView(id)])) as Record<StateId, StateView>;
