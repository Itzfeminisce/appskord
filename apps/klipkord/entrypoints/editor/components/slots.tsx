import type { ComponentType, ReactNode } from 'react';
import type { Cut, Project } from '@/lib/project/types';
import type { Recording } from '@/lib/types';
import { TimelineOpeningBody } from '../timeline/Opening';
import { NoVoice, TranscriptFailed, WordsPending } from '../states/transcript';
import { ICON } from '../transcript/icons';
import { Bone, C, Icon, iconButton } from '../ui';

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
  play(): void;
  pause?(): void;
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

const LINES = [78, 64, 82, 55, 70, 60, 74, 48, 66];

function TranscriptSkeleton() {
  return (
    <>
      {LINES.map((w, i) => <Bone key={i} style={{ height: 10, width: `${w}%`, borderRadius: 5, margin: '9px 6px 0 46px' }} />)}
    </>
  );
}

/** The transcript column's frame; T6's body brings its own header tools and footer. */
export function TranscriptFrame({ children, opening = false, tools, footer }: { children: ReactNode; opening?: boolean; tools?: ReactNode; footer?: ReactNode }) {
  return (
    <section aria-label="Transcript" style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${C.line}`, background: C.panel }}>
      <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 0 14px' }}>
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, flexGrow: 1 }}>Transcript</h2>
        {tools}
      </div>
      <div style={{ flexGrow: 1, minHeight: 0, overflow: 'hidden', padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>
      <div style={{ flexShrink: 0, minHeight: 32, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderTop: `1px solid ${C.line}`, fontSize: 11.5, color: C.secondary }}>
        {opening && <span style={{ color: C.muted }}>The transcript appears here in a moment.</span>}
        {footer}
      </div>
    </section>
  );
}

/** The opening header tools: Find shows, Clean up waits for the words. */
const OPENING_TOOLS = (
  <>
    <button type="button" aria-label="Find in transcript (Ctrl+F)" title="Find in transcript (Ctrl+F)" disabled style={{ ...iconButton(28), cursor: 'default' }}>
      <Icon>{ICON.search}</Icon>
    </button>
    <button type="button" disabled style={{
      height: 28, padding: '0 12px', borderRadius: 8, background: C.raised, color: C.text, border: `1px solid ${C.line}`, fontFamily: 'inherit', fontSize: 13,
      fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'default', whiteSpace: 'nowrap', boxSizing: 'border-box', opacity: 0.45,
    }}><Icon size={15}>{ICON.wand}</Icon><span>Clean up</span></button>
  </>
);

/** The transcript column while the editor opens. */
export const TranscriptOpening = () => <TranscriptFrame opening tools={OPENING_TOOLS}><TranscriptSkeleton /></TranscriptFrame>;

/** The transcript column (left, 320 px). T6 fills it through `body`. */
export function TranscriptColumn({ body: Body, ...p }: TranscriptSlotProps & { body?: ComponentType<TranscriptSlotProps> }) {
  if (!p.ready) return <TranscriptOpening />;
  let content: ReactNode;
  if (p.state === 'words-pending') content = <WordsPending onGroq={p.onGroq} />;
  else if (p.state === 'transcript-failed') content = <TranscriptFailed stoppedAt={p.failedAt ?? 0} onRetry={p.onRetry ?? (() => {})} onGroq={p.onGroq} />;
  else if (p.state === 'no-voice') content = <NoVoice />;
  else if (Body) return <Body {...p} />;
  else content = <TranscriptSkeleton />;
  return <TranscriptFrame opening={false}>{content}</TranscriptFrame>;
}

function TimelineFrame({ children }: { children: ReactNode }) {
  return (
    <section aria-label="Timeline" style={{ height: 232, flexShrink: 0, display: 'flex', flexDirection: 'column', borderTop: `1px solid ${C.line}`, background: C.ground }}>{children}</section>
  );
}

/** The timeline's opening look: toolbar, ruler and six named track rows. */
export function TimelineOpening(p: { project?: Project; cut?: Cut; length?: number }) {
  return <TimelineFrame><TimelineOpeningBody {...p} /></TimelineFrame>;
}

/** The timeline (bottom, 232 px, under transcript and preview). T7 fills it through `body`. */
export function TimelineSlot({ body: Body, ...p }: SlotProps & { body?: ComponentType<SlotProps> }) {
  if (!Body || !p.ready) return <TimelineOpening project={p.project} cut={p.cut} length={p.length} />;
  return <TimelineFrame><Body {...p} /></TimelineFrame>;
}
