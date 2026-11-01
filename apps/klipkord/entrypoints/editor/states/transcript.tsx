import { clock } from '../format';
import { StateCard } from './StateCard';

const CARD = { margin: '4px 6px' };

/** words-pending: `progress` 0..1 when the transcriber reports it. */
export function WordsPending({ progress, onGroq }: { progress?: number; onGroq?: () => void }) {
  const tail = progress === undefined ? '' : ` Transcribing · ${Math.round(progress * 100)}%`;
  return (
    <StateCard state="words-pending" role="status" style={CARD} title="Words are on their way"
      body={`Editing by text, clean up and captions turn on when the transcript is ready. You can cut on the timeline now.${tail}`}
      actions={onGroq ? [{ label: 'Use Groq instead', tone: 'secondary', onClick: onGroq }] : []} />
  );
}

/** transcript-failed: `stoppedAt` is the recording time the speech model reached, ms. */
export function TranscriptFailed({ stoppedAt, onRetry, onGroq }: { stoppedAt: number; onRetry: () => void; onGroq: () => void }) {
  return (
    <StateCard state="transcript-failed" role="alert" style={CARD} title="Couldn't make the transcript"
      body={`The speech model stopped at ${clock(stoppedAt)}. Your video is fine.`}
      actions={[{ label: 'Try again', tone: 'primary', onClick: onRetry }, { label: 'Use Groq instead', tone: 'secondary', onClick: onGroq }]} />
  );
}

export function NoVoice() {
  return (
    <StateCard state="no-voice" role="status" style={CARD} title="No talking found"
      body="This recording has no voice, so there is nothing to edit by text. Use the timeline to cut." />
  );
}
