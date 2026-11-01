import type { ReactNode } from 'react';
import { useRouter } from '../entrypoints/sidepanel/router';
import { HOSTS, requestHost } from '../lib/hostAccess';
import { draft, runner, useRun, useSettings, type MakeState } from '../lib/makeClip';
import { FALLBACK_MODEL } from '../lib/llm';
import { PROVIDERS } from '../lib/providers';
import type { Provider } from '../lib/types';
import { KeyNeeded } from './StatesCreate';
import { PenvDisconnected, ProviderAccess } from './StatesSetup';
import { RecipeThumb, TYPE_NAMES } from './Templates';

const check = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const cross = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--error-ink)" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>;
const retry = <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>;

/** The failed step's reason: the message line of that state's card. */
export function reasonFor(failure: MakeState, provider: Provider, model: string): string {
  const name = PROVIDERS[provider].label;
  switch (failure) {
    case 'provider-down': return `${name} isn’t responding`;
    case 'provider-busy': return `${name} is still busy`;
    case 'offline': return 'You’re offline';
    case 'model-not-found': return `${name} doesn’t have ${model}`;
    case 'model-not-for-text': return `${model} can’t write clips`;
    case 'key-needed': return 'Paste your key again';
    case 'penv-disconnected': return 'Penv Cloud was disconnected';
    case 'provider-access': return `Allow Motikord to reach ${name}`;
    default: return 'The AI’s answer didn’t work, even on a second try.';
  }
}

/** Failures that keep their own card, with its action first and "Try again" second. */
const OWN_CARD: MakeState[] = ['key-needed', 'penv-disconnected', 'provider-access'];

/** Every failure while making lands here: what was kept, the step that failed and why, and "Try again". */
export default function MakingFailed() {
  const { navigate, replace } = useRouter();
  const run = useRun();
  const settings = useSettings();
  const provider = settings?.provider ?? 'groq';
  const failure: MakeState = run.status === 'failed' && run.failure ? run.failure : 'making-failed';
  const model = settings?.models[provider] ?? FALLBACK_MODEL[provider];
  const failedAt = Math.min(run.steps, 3);
  const scenes = run.recipe?.scenes.length;

  // Same prompt, picks, type and size. Chrome only asks for the host inside the click, before anything is awaited.
  const again = () => {
    const access = settings?.ai === 'local' ? Promise.resolve('granted' as const) : requestHost(HOSTS[provider]);
    // start() marks the run as running before its first await, so Making doesn't bounce straight back here.
    void access.then((a) => { void runner.start(draft.get(), { access: a }); replace('Making'); });
  };
  const changePrompt = () => { runner.reset(); replace('Home'); };

  const labels: ReactNode[] = [
    <>Clip type{run.type ? <>: <strong style={{ fontWeight: 600 }}>{TYPE_NAMES[run.type]}</strong></> : null}</>,
    scenes ? `Writing ${scenes} scene${scenes === 1 ? '' : 's'}` : 'Writing scenes',
    'Choosing motion and layout',
    'Checking text fits and reads well',
  ];

  let card: ReactNode = null;
  if (failure === 'key-needed') card = <KeyNeeded onPasteKey={() => navigate('PasteKey')} />;
  else if (failure === 'penv-disconnected') card = <PenvDisconnected onConnect={() => navigate('PenvConnect')} />;
  else if (failure === 'provider-access') card = <ProviderAccess provider={provider} onAllow={again} />;
  const own = OWN_CARD.includes(failure);

  const big = { height: 48, borderRadius: 12, font: '600 15px var(--font)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', width: '100%' } as const;
  const outlined = { ...big, height: 44, fontSize: 14, background: 'var(--surface)', border: '1px solid #E0E0E4', color: 'var(--ink)' } as const;

  return (
    <main data-frame="MakingFailed" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.02em' }}>Couldn’t make your clip</h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>Your prompt and picks are kept. Nothing was lost.</p>
      </div>

      <div style={{ margin: '20px auto 0', width: 132, height: 234, borderRadius: 14, background: '#F4F4F5', position: 'relative', overflow: 'hidden', opacity: 0.7 }}>
        {run.recipe && <RecipeThumb recipe={run.recipe} height={234} />}
        <span style={{ position: 'absolute', left: 0, bottom: 0, height: 4, width: `${Math.max(failedAt, 1) / 4 * 100}%`, background: '#DC2626' }} />
      </div>

      {card && <div style={{ margin: '16px 16px 0' }}>{card}</div>}

      <ol style={{ listStyle: 'none', margin: '18px 16px 0', padding: '6px 16px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
        {labels.slice(0, failedAt + 1).map((l, i) => i < failedAt
          ? <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: '1px solid #EFEFF1' }}>{check}<span style={{ fontSize: 14 }}>{l}</span></li>
          : (
            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 0' }}>
              {cross}
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{l}</span>
                <span role="alert" style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{reasonFor(failure, provider, model)}</span>
              </span>
            </li>
          ))}
      </ol>

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button type="button" onClick={again} style={own ? outlined : { ...big, border: 0, background: 'var(--accent)', color: '#fff' }}>{retry}Try again</button>
        {(failure === 'model-not-found' || failure === 'model-not-for-text') && <button type="button" onClick={() => navigate('Settings')} style={outlined}>Change model</button>}
        <button type="button" onClick={changePrompt} style={outlined}>Change the prompt</button>
        <button type="button" onClick={() => navigate('Templates')} style={{ border: 0, background: 'none', font: '500 13px var(--font)', color: 'var(--accent)', cursor: 'pointer' }}>Start from a template instead</button>
      </div>
    </main>
  );
}
