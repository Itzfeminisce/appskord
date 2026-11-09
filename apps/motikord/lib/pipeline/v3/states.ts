// v3 pipeline states and their copy, verbatim from the StatesV3, LookLock and MakingMotion frames.

export type PipelineStateId =
  | 'keyframe-failed'
  | 'keyframes-waiting'
  | 'motion-failed'
  | 'animate-layer-failed'
  | 'animate-layer-unclear'
  | 'critic-not-available'
  | 'critic-ai-failed'
  | 'critic-fix-limit';

export interface StateCopy {
  id: PipelineStateId;
  title: string;
  line: string;
  action?: string;
}

/** The copy a state shows; `scene` is numbered from 1, `provider` is the provider's label ("Groq"). */
export function stateCopy(id: PipelineStateId, v: { scene?: number; provider?: string } = {}): StateCopy {
  const n = v.scene ?? 1;
  switch (id) {
    case 'keyframe-failed':
      return {
        id,
        title: `Scene ${n}’s key frame couldn’t be drawn`,
        line: 'Your other key frames are kept. Try again to draw just this one.',
        action: 'Try again',
      };
    case 'keyframes-waiting':
      return { id, title: 'Drawing your key frames…', line: KEY_FRAMES.line };
    case 'motion-failed':
      return {
        id,
        title: `Adding motion stopped at scene ${n}`,
        line: `Your approved key frames are kept. Try again to carry on from scene ${n}.`,
        action: 'Try again',
      };
    case 'animate-layer-failed':
      return {
        id,
        title: `${v.provider ?? 'Groq'} didn’t answer`,
        line: 'Your layer is unchanged. Try again to send the same words.',
        action: 'Try again',
      };
    case 'animate-layer-unclear':
      return {
        id,
        title: 'Motikord couldn’t turn those words into motion',
        line: 'Your layer is unchanged. Say what moves and how, like “words slide up one by one”.',
        action: 'Try other words',
      };
    case 'critic-not-available':
      return {
        id,
        title: 'Your model can’t see images',
        line: 'The Story pass still ran. Pick a model that sees images to check the look and motion too.',
        action: 'Change model',
      };
    case 'critic-ai-failed':
      return {
        id,
        title: 'The AI pass didn’t run',
        line: `${v.provider ?? 'Groq'} didn’t answer. Your free checks still ran, so their notes are below. Try again to run the AI pass.`,
        action: 'Try again',
      };
    case 'critic-fix-limit':
      return {
        id,
        title: `Scene ${n} still needs your eye`,
        line: 'Motikord used its one automatic fix here. The scene stays as it is until you choose.',
        action: 'Show me',
      };
  }
}

/** LookLock copy. */
export const KEY_FRAMES = {
  title: 'Check the key frames',
  line: 'One still per scene in your look. Approve them, then Motikord adds the motion. No AI cost.',
  approve: 'Approve',
  approved: 'Approved',
  approveAll: 'Approve all',
  tryAnother: 'Try another',
  drawingAnother: 'Drawing another…',
  waiting: 'Waiting',
  addMotion: 'Add the motion',
  addMotionLine: 'Motion is added on this computer. No AI cost.',
  approveMore: (n: number) => `Approve ${n} more to add the motion`,
  count: (done: number, total: number) => `${done} of ${total}`,
} as const;

/** MakingMotion copy. */
export const MAKING_MOTION = {
  title: 'Making your clip',
  line: 'Key frames locked. Motikord is adding the motion.',
  approved: 'Key frames approved',
  adding: (i: number, n: number) => `Adding motion to scene ${i} of ${n}`,
  addingLine: 'Springs, camera and depth, on this computer.',
  check: 'Quality check',
  checkLine: 'Story · Same look throughout · Look and motion',
} as const;
