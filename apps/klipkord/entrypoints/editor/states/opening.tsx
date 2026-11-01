import { formatDuration } from '@/lib/time';
import { seconds } from '../format';
import { C, Icon, ICONS, MONO } from '../ui';
import { StateCard } from './StateCard';

export const OPENING_STEPS = ['Reading the video', 'Drawing the timeline', 'Lining up words and clicks'] as const;
/** EditorOpening turns into opening-slow after this long without a first frame. */
export const OPENING_SLOW_MS = 8000;
/** long-recording: the preview may stutter past this length on the owner's laptop. */
export const LONG_RECORDING_MS = 60 * 60 * 1000;

/** ms each step took once done; undefined while it runs or waits. Steps finish in order. */
export type StepTimes = [number?, number?, number?];

function StepMark({ phase }: { phase: 'done' | 'running' | 'waiting' }) {
  if (phase === 'done') {
    return (
      <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(34,197,94,0.18)', color: C.ok, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={12}>{ICONS.check}</Icon>
      </span>
    );
  }
  const ring = phase === 'running' ? { border: `2px solid ${C.accentText}`, borderRightColor: 'transparent', animation: 'klipkord-spin 0.9s linear infinite' } : { border: `2px solid ${C.line}` };
  return <span style={{ width: 18, height: 18, borderRadius: '50%', boxSizing: 'border-box', flexShrink: 0, ...ring }} />;
}

/** EditorOpening: the steps in the preview until the first frame shows. */
export function OpeningSteps({ times }: { times: StepTimes }) {
  const running = times.findIndex((t) => t === undefined);
  return (
    <div data-state="opening" role="status" style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 300 }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>Getting your recording ready</span>
      {OPENING_STEPS.map((label, i) => {
        const t = times[i];
        const phase = t !== undefined ? 'done' : i === running ? 'running' : 'waiting';
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: phase === 'waiting' ? C.muted : C.text }}>
            <StepMark phase={phase} />
            <span style={{ flexGrow: 1 }}>{label}</span>
            <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.muted }}>{t !== undefined ? seconds(t) : ''}</span>
          </div>
        );
      })}
      <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>You can press Play as soon as the first frame shows.</span>
    </div>
  );
}

export function OpeningSlow({ onWait, onLibrary }: { onWait: () => void; onLibrary: () => void }) {
  return (
    <StateCard state="opening-slow" role="status" style={{ width: 340 }} title="Still getting this ready"
      body="Long recordings take a little longer the first time. Next time it opens straight away."
      actions={[{ label: 'Keep waiting', tone: 'secondary', onClick: onWait }, { label: 'Back to library', tone: 'ghost', onClick: onLibrary }]} />
  );
}

export function LongRecording({ duration, onOpen, onLibrary }: { duration: number; onOpen: () => void; onLibrary: () => void }) {
  return (
    <StateCard state="long-recording" title={`This recording is ${formatDuration(duration)}`}
      body="On this computer the preview may stutter after 60 minutes. Exports are not affected."
      actions={[{ label: 'Open anyway', tone: 'primary', onClick: onOpen }, { label: 'Back to library', tone: 'ghost', onClick: onLibrary }]} />
  );
}
