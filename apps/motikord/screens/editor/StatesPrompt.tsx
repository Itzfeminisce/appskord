import type { ReactNode } from 'react';
import { clockShort } from '../../lib/editor/store';

// The prompt box's states: prompt-working, prompt-failed, change-too-long (StatesEditor), groq-busy, groq-down, offline (StatesCreate), groq-access (StatesSetup).

const svg = (size: number, stroke: string, body: ReactNode, w = 2) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>{body}</svg>
);
const outline = {
  height: 34, padding: '0 12px', border: '1px solid var(--line-strong)', borderRadius: 9, background: 'var(--surface)', color: 'var(--ink)',
  font: '600 13px/1 var(--font)', cursor: 'pointer',
} as const;
const dark = { ...outline, border: 0, background: 'var(--ink)', color: '#fff' } as const;

type Tone = 'plain' | 'warning' | 'error';
function Card({ tone, icon, title, children, action }: { tone: Tone; icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  const bg = tone === 'plain' ? 'var(--surface)' : `var(--${tone}-bg)`;
  const line = tone === 'plain' ? 'var(--line)' : `var(--${tone}-line)`;
  return (
    <div role={tone === 'plain' ? 'status' : 'alert'} style={{ padding: 14, borderRadius: 14, background: bg, border: `1px solid ${line}`, display: 'flex', gap: 12, alignItems: 'flex-start', boxShadow: '0 6px 20px rgba(16,16,20,0.08)' }}>
      {icon}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{children}</span>
        {action && <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>{action}</div>}
      </div>
    </div>
  );
}

/** Takes the prompt box's place while the AI works. */
export function PromptWorking({ onStop }: { onStop?: () => void }) {
  return (
    <div role="status" style={{ height: 46, boxSizing: 'border-box', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line-strong)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 6px 0 14px' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ animation: 'spin 0.8s linear infinite' }}><path d="M12 3a9 9 0 1 0 9 9" /></svg>
      <span style={{ flexGrow: 1, fontSize: 14, color: 'var(--muted)' }}>Changing your clip…</span>
      <button type="button" onClick={onStop} style={{ ...outline, borderRadius: 10 }}>Stop</button>
    </div>
  );
}

export function PromptFailed({ onRetry }: { onRetry?: () => void }) {
  return (
    <Card tone="error" icon={svg(20, 'var(--error-ink)', <><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></>)} title="Motikord couldn’t make that change"
      action={<button type="button" onClick={onRetry} style={outline}>Try again</button>}>
      Your clip is unchanged. Try saying it another way, like “make the title bigger”.
    </Card>
  );
}

export function ChangeTooLong({ totalMs }: { totalMs: number }) {
  return (
    <Card tone="plain" icon={svg(20, 'var(--muted)', <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></>)} title={`That would make the clip ${clockShort(totalMs)}`}>
      Clips can be up to 60 seconds, so nothing was changed. Try fewer scenes, or shorter ones.
    </Card>
  );
}

export function GroqBusy({ seconds, onTryNow }: { seconds: number; onTryNow?: () => void }) {
  return (
    <Card tone="warning" icon={svg(20, 'var(--warning-ink)', <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>)} title="Groq is busy right now"
      action={<button type="button" onClick={onTryNow} style={outline}>Try now</button>}>
      {`You’ve reached Groq’s free limit for the moment. Motikord will try again in ${seconds} seconds.`}
    </Card>
  );
}

export function GroqBusyRetried({ onTryNow }: { onTryNow?: () => void }) {
  return (
    <Card tone="warning" icon={svg(20, 'var(--warning-ink)', <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>)} title="Groq is still busy"
      action={<button type="button" onClick={onTryNow} style={outline}>Try now</button>}>
      Motikord tried again and Groq is still at its free limit. Try now, or come back in a few minutes.
    </Card>
  );
}

export function GroqDown({ onOpenSettings }: { onOpenSettings?: () => void }) {
  return (
    <Card tone="warning" icon={svg(20, 'var(--warning-ink)', <><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5v.01" /></>)} title="Groq isn’t responding"
      action={<button type="button" onClick={onOpenSettings} style={dark}>Open Settings</button>}>
      Your clips are safe, and you can still edit by hand and export. Or let Chrome’s built-in AI write clips for now.
    </Card>
  );
}

export function Offline() {
  return (
    <Card tone="plain" icon={svg(20, 'var(--muted)', <path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19v.01M3 3l18 18" />)} title="You’re offline">
      Making and changing clips with words needs the internet. Editing by hand, the bundled music and exports still work.
    </Card>
  );
}

export function GroqAccess({ onAllow }: { onAllow?: () => void }) {
  return (
    <Card tone="plain" icon={svg(20, 'var(--accent)', <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>)} title="Allow Motikord to reach Groq"
      action={<button type="button" onClick={onAllow} style={dark}>Allow</button>}>
      Chrome asks once. Only your prompt and the clip’s text are sent to api.groq.com.
    </Card>
  );
}

/** For the StatesEditor dev gallery: each card with the frame's sample content. */
export const PROMPT_STATES: [string, ReactNode][] = [
  ['prompt-working · Editor prompt box', <PromptWorking />],
  ['prompt-failed · Editor', <PromptFailed />],
  ['change-too-long · Editor', <ChangeTooLong totalMs={72_000} />],
  ['groq-busy · Making your clip, Editor', <GroqBusy seconds={20} />],
  ['groq-busy-retried · Making your clip, Editor', <GroqBusyRetried />],
  ['groq-down · Make a clip, Editor', <GroqDown />],
  ['offline · Make a clip, Editor (banner)', <Offline />],
];
