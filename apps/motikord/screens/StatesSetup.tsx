import type { ReactNode } from 'react';
import { PROVIDERS, withArticle } from '../lib/providers';
import type { Provider } from '../lib/types';

type Tone = 'plain' | 'warning' | 'error';
type Glyph = 'info' | 'warn' | 'lock' | 'cross' | 'spin';

const TONE: Record<Tone, { bg: string; line: string }> = {
  plain: { bg: 'var(--surface)', line: 'var(--line)' },
  warning: { bg: 'var(--warning-bg)', line: 'var(--warning-line)' },
  error: { bg: 'var(--error-bg)', line: 'var(--error-line)' },
};

function Icon({ glyph }: { glyph: Glyph }) {
  const p = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, 'aria-hidden': true, style: { flexShrink: 0 } };
  if (glyph === 'warn') return <svg {...p} stroke="#B45309" strokeLinejoin="round"><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5v.01" /></svg>;
  if (glyph === 'lock') return <svg {...p} stroke="var(--accent)" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
  if (glyph === 'spin') return <svg {...p} stroke="var(--accent)" strokeWidth={2.4} style={{ flexShrink: 0, animation: 'spin 0.8s linear infinite' }}><path d="M12 3a9 9 0 1 0 9 9" /></svg>;
  if (glyph === 'cross') return <svg {...p} stroke="var(--error-ink)"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>;
  return <svg {...p} stroke="var(--muted)"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></svg>;
}

export const actionStyle = {
  height: 34, padding: '0 12px', border: 0, borderRadius: 9, background: 'var(--ink)', color: '#fff',
  font: '600 13px/1 var(--font)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
} as const;

/** The second action on a card: outlined. */
export const secondaryStyle = { ...actionStyle, background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line-strong)' } as const;

/** The state card every Setup, key and access state shares: icon, a title, what still works, and one or two actions. */
export function StateCard({ tone = 'plain', glyph, title, children, actions, role }: {
  tone?: Tone; glyph: Glyph; title: string; children: ReactNode; actions?: ReactNode; role?: 'status' | 'alert';
}) {
  const t = TONE[tone];
  return (
    <div role={role} style={{ padding: 14, borderRadius: 14, background: t.bg, border: `1px solid ${t.line}`, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <Icon glyph={glyph} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{children}</span>
        {actions && <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>{actions}</div>}
      </div>
    </div>
  );
}

const link = (href: string, text: string) => <a key={href + text} href={href} target="_blank" rel="noreferrer" style={actionStyle}>{text}</a>;
const act = (text: string, onClick?: () => void, style: object = actionStyle) => <button key={text} type="button" onClick={onClick} style={style}>{text}</button>;
const label = (p: Provider) => PROVIDERS[p].label;

export function NoBuiltInAi({ provider = 'groq', onUseGroq }: { provider?: Provider; onUseGroq?: () => void }) {
  return <StateCard glyph="info" title="Chrome’s built-in AI isn’t on this computer" actions={act(`Use ${label(provider)}`, onUseGroq)}>{`Motikord will use ${label(provider)} to write your clips. Editing, preview and export still run here.`}</StateCard>;
}
export function SlowComputer() {
  return <StateCard tone="warning" glyph="warn" title="The preview may be slow on this computer">Motikord will show a lighter preview while you edit. Your exports are still full quality.</StateCard>;
}
export function NoFastExport() {
  return <StateCard tone="warning" glyph="warn" title="Exports will take longer here">This computer has no video chip Motikord can use. Exports still work and are full quality.</StateCard>;
}
/** provider-access: first "Make clip" shows this; Allow asks Chrome for the provider's host. */
export function ProviderAccess({ provider = 'groq', name, host, onAllow }: { provider?: Provider; name?: string; host?: string; onAllow?: () => void }) {
  const n = name ?? label(provider);
  return <StateCard glyph="lock" title={`Allow Motikord to reach ${n}`} actions={act('Allow', onAllow)}>{`Chrome asks once. Only your prompt and the clip’s text are sent to ${host ?? PROVIDERS[provider].host}.`}</StateCard>;
}
export function PenvNotConnected({ onTryAgain, onPaste }: { onTryAgain?: () => void; onPaste?: () => void }) {
  return (
    <StateCard role="alert" glyph="info" title="Penv Cloud didn’t connect" actions={[act('Try again', onTryAgain), act('Paste a key', onPaste)]}>
      The window closed before you chose keys. Nothing was shared.
    </StateCard>
  );
}
export function PenvNoUsableKeys({ provider = 'groq', onPaste }: { provider?: Provider; onPaste?: () => void }) {
  return (
    <StateCard tone="warning" glyph="warn" title={`No ${label(provider)} key was shared with Motikord`} actions={[link('https://penv.cloud', 'Open Penv Cloud'), act('Paste a key', onPaste)]}>
      {`Add ${PROVIDERS[provider].keyName} in Penv Cloud and choose it for Motikord, or paste one here.`}
    </StateCard>
  );
}
/** The banner on Make a clip (T5) when Penv Cloud stopped accepting the connection. */
export function PenvDisconnected({ onConnect }: { onConnect?: () => void }) {
  return (
    <StateCard tone="warning" glyph="warn" title="Penv Cloud was disconnected" actions={act('Connect Penv Cloud', onConnect)}>
      Your clips are safe, and you can still edit and export. Connect again to make clips with words.
    </StateCard>
  );
}
const getKey = (p: Provider) => link(PROVIDERS[p].keysUrl, PROVIDERS[p].getKey);

export function KeyNotRecognised({ provider = 'groq' }: { provider?: Provider }) {
  const { label: n, prefix } = PROVIDERS[provider];
  return (
    <StateCard tone="error" role="alert" glyph="cross" title="Motikord doesn’t recognise this key" actions={getKey(provider)}>
      {`It isn’t ${withArticle(n)} or Pexels key. ${n} keys start with ${prefix}. Check you copied all of it.`}
    </StateCard>
  );
}
export function KeyRejected({ provider = 'groq' }: { provider?: Provider }) {
  return (
    <StateCard tone="error" role="alert" glyph="cross" title={`${label(provider)} didn’t accept this key`} actions={getKey(provider)}>
      It may have been deleted, or a letter is missing. Make a new key and paste it here.
    </StateCard>
  );
}
export function PexelsKeyRejected() {
  return (
    <StateCard tone="error" role="alert" glyph="cross" title="Pexels didn’t accept this key" actions={link('https://www.pexels.com/api/', 'Get a free Pexels key')}>
      Media search still works with Openverse. Make a new Pexels key and paste it here.
    </StateCard>
  );
}
export function KeyCheckUnreachable({ onTryAgain }: { onTryAgain?: () => void }) {
  return (
    <StateCard tone="warning" role="status" glyph="warn" title="Motikord can’t check your key right now" actions={act('Try again', onTryAgain)}>
      You may be offline, or the service is down. Your key is kept until Chrome closes, and Motikord will check it again as soon as it’s back.
    </StateCard>
  );
}
export function KeyChecking({ service }: { service: string }) {
  return (
    <div role="status" style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'center' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ animation: "spin 0.8s linear infinite" }}><path d="M12 3a9 9 0 1 0 9 9" /></svg>
      <span style={{ fontSize: 13 }}>This is a {service} key · Checking…</span>
    </div>
  );
}

/** key-wrong-provider: the pasted key's prefix belongs to another provider. */
export function KeyWrongProvider({ provider = 'groq', detected = 'openai', onSwitch }: { provider?: Provider; detected?: Provider; onSwitch?: () => void }) {
  const d = label(detected);
  return (
    <StateCard tone="error" role="alert" glyph="cross" title={`This looks like ${withArticle(d)} key`} actions={[act(`Switch to ${d}`, onSwitch), getKey(provider)]}>
      {`You chose ${label(provider)}, and its keys start with ${PROVIDERS[provider].prefix}. Paste ${withArticle(label(provider))} key, or switch provider to ${d}.`}
    </StateCard>
  );
}
const SHEET: [string, ReactNode][] = [
  ['no-built-in-ai · Setup, Settings', <NoBuiltInAi />],
  ['slow-computer · Setup', <SlowComputer />],
  ['no-fast-export · Setup', <NoFastExport />],
  ['provider-access · first “Make clip” (Chrome asks once)', <ProviderAccess />],
  ['penv-not-connected · Connect Penv Cloud', <PenvNotConnected />],
  ['penv-no-usable-keys · Penv Cloud connected', <PenvNoUsableKeys />],
  ['penv-disconnected · Make a clip (banner)', <PenvDisconnected />],
  ['key-not-recognised · Paste a key', <KeyNotRecognised />],
  ['key-rejected · Paste a key', <KeyRejected />],
  ['pexels-key-rejected · Paste a key', <PexelsKeyRejected />],
  ['key-check-unreachable · PasteKey', <KeyCheckUnreachable />],
  ['key-wrong-provider · Paste a key', <KeyWrongProvider />],
  ['key-checking · Paste a key', <KeyChecking service="Groq" />],
];

/** Every Setup, Penv Cloud and key state on one sheet. */
export default function StatesSetup() {
  return (
    <main data-frame="StatesSetup" style={{ padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {SHEET.map(([label, card]) => (
        <section key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 className="mono" style={{ margin: 0, padding: '0 4px', fontSize: 11, fontWeight: 500, color: 'var(--faint)' }}>{label}</h2>
          {card}
        </section>
      ))}
    </main>
  );
}
