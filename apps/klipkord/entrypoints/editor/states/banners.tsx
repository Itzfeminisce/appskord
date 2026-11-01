import { StateCard } from './StateCard';

/** old-recording: above the preview for v1/v2 recordings, whose camera is baked into the screen video. */
export function OldRecording({ onDismiss }: { onDismiss: () => void }) {
  return (
    <StateCard state="old-recording" role="status" title="Made with an older Klipkord"
      body="The camera is part of the screen video, so camera layouts and background blur are off. Everything else works."
      actions={[{ label: 'Got it', tone: 'primary', onClick: onDismiss }]} />
  );
}

export function MediaMissing({ name, onFind, onRemove }: { name: string; onFind: () => void; onRemove: () => void }) {
  return (
    <StateCard state="media-missing" role="alert" title={`A file is missing: ${name}`}
      body="It was removed from Klipkord's storage. The rest of the project is fine."
      actions={[{ label: 'Find the file', tone: 'primary', onClick: onFind }, { label: 'Remove it', tone: 'ghost', onClick: onRemove }]} />
  );
}

/** not-saved: the top bar says "Not saved" and this card explains why. */
export function NotSaved({ onFreeUp, onRetry }: { onFreeUp: () => void; onRetry: () => void }) {
  return (
    <StateCard state="not-saved" role="alert" title="Couldn't save your last change"
      body="Klipkord is out of storage on this computer. Your edits are kept in this tab until you free some space."
      actions={[{ label: 'Free up space', tone: 'primary', onClick: onFreeUp }, { label: 'Try again', tone: 'ghost', onClick: onRetry }]} />
  );
}

/** preview-slow: under the preview, once per editor session. */
export function PreviewSlow({ onLight, onDismiss }: { onLight: () => void; onDismiss: () => void }) {
  return (
    <StateCard state="preview-slow" role="status" title="Preview is dropping frames"
      body="Turn on Light preview to keep it smooth. Exports are always full quality."
      actions={[{ label: 'Light preview', tone: 'primary', onClick: onLight }, { label: 'Not now', tone: 'ghost', onClick: onDismiss }]} />
  );
}
