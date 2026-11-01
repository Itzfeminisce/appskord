import type { ComponentType, ReactNode } from 'react';
import type { Cut, Project } from '@/lib/project/types';
import type { Recording } from '@/lib/types';
import { NoVoice, TranscriptFailed, WordsPending } from '../states/transcript';
import { Bone, C } from '../ui';

/** What every editor panel gets: T6 (transcript), T7 (timeline) and T10 to T13 (inspector tabs) build on it. */
export interface SlotProps {
  recording: Recording;
  project: Project;
  cut: Cut;
  /** Playhead, output ms, and the cut's length. */
  out: number;
  length: number;
  playing: boolean;
  /** False while the editor is still opening: show the skeleton. */
  ready: boolean;
  readOnly: boolean;
  seek(out: number): void;
  /** Runs one pure op from lib/project (one Undo step) and saves. */
  edit(op: (project: Project) => Project): void;
}

/** The transcript column's state before there are words to edit. */
export type TranscriptState = 'words-pending' | 'transcript-failed' | 'no-voice' | 'ready';

/** A finished transcript with no words means no talking; nothing records a failed run yet, so T6 passes that one. */
export function transcriptState(rec: Recording): TranscriptState {
  if (rec.transcriptPending) return 'words-pending';
  return rec.transcript.length > 0 ? 'ready' : 'no-voice';
}

export interface TranscriptSlotProps extends SlotProps {
  state: TranscriptState;
  onGroq(): void;
  /** transcript-failed: where the speech model stopped, and Try again. */
  failedAt?: number;
  onRetry?: () => void;
}

const LINES = [78, 64, 82, 55, 70, 60, 74, 66, 80, 58, 72, 62];

function TranscriptSkeleton() {
  return (
    <>
      {LINES.map((w, i) => <Bone key={i} style={{ height: 10, width: `${w}%`, borderRadius: 5, margin: '9px 6px 0 46px' }} />)}
    </>
  );
}

function TranscriptFrame({ children, opening }: { children: ReactNode; opening: boolean }) {
  return (
    <section aria-label="Transcript" style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${C.line}`, background: C.panel }}>
      <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 0 14px' }}>
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, flexGrow: 1 }}>Transcript</h2>
      </div>
      <div style={{ flexGrow: 1, minHeight: 0, overflow: 'hidden', padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>
      <div style={{ flexShrink: 0, minHeight: 32, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderTop: `1px solid ${C.line}`, fontSize: 11.5, color: C.secondary }}>
        {opening && <span style={{ color: C.muted }}>The transcript appears here in a moment.</span>}
      </div>
    </section>
  );
}

/** The transcript column while the editor opens. */
export const TranscriptOpening = () => <TranscriptFrame opening><TranscriptSkeleton /></TranscriptFrame>;

/** The transcript column (left, 320 px). T6 fills it through `body`. */
export function TranscriptColumn({ body: Body, ...p }: TranscriptSlotProps & { body?: ComponentType<TranscriptSlotProps> }) {
  if (!p.ready) return <TranscriptOpening />;
  let content: ReactNode;
  if (p.state === 'words-pending') content = <WordsPending onGroq={p.onGroq} />;
  else if (p.state === 'transcript-failed') content = <TranscriptFailed stoppedAt={p.failedAt ?? 0} onRetry={p.onRetry ?? (() => {})} onGroq={p.onGroq} />;
  else if (p.state === 'no-voice') content = <NoVoice />;
  else content = Body ? <Body {...p} /> : <TranscriptSkeleton />;
  return <TranscriptFrame opening={false}>{content}</TranscriptFrame>;
}

const TRACK_ROWS = [100, 100, 62, 0, 0, 0];

function TimelineFrame({ children }: { children: ReactNode }) {
  return (
    <section aria-label="Timeline" style={{ height: 232, flexShrink: 0, display: 'flex', flexDirection: 'column', borderTop: `1px solid ${C.line}`, background: C.ground }}>{children}</section>
  );
}

/** The timeline's empty look: toolbar, ruler and six track rows. */
export function TimelineOpening() {
  return (
    <TimelineFrame>
      <div style={{ height: 36, flexShrink: 0, background: C.panel, borderBottom: `1px solid ${C.line}` }} />
      <div style={{ height: 22, flexShrink: 0, display: 'flex', borderBottom: `1px solid ${C.line}` }}><div style={{ width: 132, background: C.panel }} /></div>
      {TRACK_ROWS.map((w, i) => (
        <div key={i} style={{ display: 'flex', height: 26, borderBottom: `1px solid ${C.ground}` }}>
          <div style={{ width: 132, flexShrink: 0, background: C.panel }} />
          <div style={{ flexGrow: 1, position: 'relative' }}>
            {w > 0 && <Bone style={{ position: 'absolute', left: 0, width: `${w}%`, top: 2, bottom: 2, borderRadius: 5 }} />}
          </div>
        </div>
      ))}
    </TimelineFrame>
  );
}

/** The timeline (bottom, 232 px, under transcript and preview). T7 fills it through `body`. */
export function TimelineSlot({ body: Body, ...p }: SlotProps & { body?: ComponentType<SlotProps> }) {
  if (!Body || !p.ready) return <TimelineOpening />;
  return <TimelineFrame><Body {...p} /></TimelineFrame>;
}
