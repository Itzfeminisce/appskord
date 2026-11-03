/** StatesAI and ai-site-blocked: the cards an AI surface shows while it works and when it can't. */
import type { ReactNode } from 'react';
import { providerLabel } from './choice';
import type { AiStateName } from './run';

export type Surface = 'brief' | 'diagram' | 'order' | 'summary';

const Done = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
);
const Spin = () => (
  <svg className="bk-ai-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>
);

export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function AiWorking({ steps, onStop }: { steps?: string[]; onStop(): void }) {
  return (
    <div aria-busy="true" className="bk-ai-state">
      <span className="bk-ai-state-title">Getting you ready…</span>
      {steps?.map((step, i) => (
        <span key={step} className={`bk-ai-step${i === 1 ? ' is-now' : i > 1 ? ' is-later' : ''}`}>
          {i === 0 ? <span className="bk-ai-step-done"><Done /></span> : i === 1 ? <span className="bk-ai-step-now"><Spin /></span> : <span className="bk-ai-step-ring" />}
          {step}
        </span>
      ))}
      <span className="bk-ai-state-foot">
        <span />
        <button type="button" className="bk-ai-btn is-small" onClick={onStop}>Stop</button>
      </span>
    </div>
  );
}

export interface StateActions {
  onRetry(): void;
  /** "Pick another model" / "Pick another provider". */
  onPick(): void;
  /** Settings "AI and keys": no key, key refused. */
  onSettings(): void;
  /** "Ask Chrome again": calls Chrome's prompt first in the click. */
  onAskChrome(): void;
}

const BAD_REPLY: Record<Surface, { title: string; text: string }> = {
  diagram: {
    title: 'That answer didn’t make a usable diagram',
    text: 'Briefkord asked twice and the steps didn’t connect. Your board hasn’t changed. Try fewer steps, or another model.',
  },
  brief: { title: 'That answer didn’t make a usable brief', text: 'Briefkord asked twice and the reply didn’t fit. Your board hasn’t changed. Try again, or another model.' },
  order: { title: 'That answer didn’t make a usable order', text: 'Briefkord asked twice and the reply didn’t fit. Your board hasn’t changed. Try again, or another model.' },
  summary: { title: 'That answer didn’t make a usable summary', text: 'Briefkord asked twice and the reply didn’t fit. Your board hasn’t changed. Try again, or another model.' },
};

function Card({ tone, title, text, children, role = 'alert' }: { tone?: 'warn' | 'error'; title: string; text: string; children?: ReactNode; role?: string }) {
  return (
    <div role={role} className={`bk-ai-state${tone ? ` is-${tone}` : ''}`}>
      <span className="bk-ai-state-title">{title}</span>
      <span className="bk-ai-state-text">{text}</span>
      {children && <span className="bk-ai-state-actions">{children}</span>}
    </div>
  );
}

export function AiState({ state, provider, surface, actions }: { state: AiStateName; provider: string; surface: Surface; actions: StateActions }) {
  const name = providerLabel(provider);
  switch (state) {
    case 'ai-no-key':
      return (
        <Card role="status" title="Pick a model to use AI" text="Choose any provider and model, then add its key. Briefkord sends only the text each action needs.">
          <span className="bk-ai-col">
            <button type="button" className="bk-ai-btn is-primary is-wide" onClick={actions.onSettings}>Connect Penv Cloud</button>
            <button type="button" className="bk-ai-btn is-wide" onClick={actions.onSettings}>Paste a key instead</button>
          </span>
        </Card>
      );
    case 'ai-bad-reply':
      return (
        <Card title={BAD_REPLY[surface].title} text={BAD_REPLY[surface].text}>
          <button type="button" className="bk-ai-btn is-primary is-grow" onClick={actions.onRetry}>Try again</button>
          <button type="button" className="bk-ai-btn is-grow" onClick={actions.onPick}>Pick another model</button>
        </Card>
      );
    case 'ai-unreachable':
      return (
        <Card tone="warn" title={`${name} isn’t answering`} text="Your board is fine and nothing was sent. Try again in a minute, or pick another model.">
          <button type="button" className="bk-ai-btn is-grow" onClick={actions.onRetry}>Try again</button>
          <button type="button" className="bk-ai-btn is-grow" onClick={actions.onPick}>Pick another model</button>
        </Card>
      );
    case 'ai-key-refused':
      return (
        <Card tone="error" title={`${name} refused the key`} text="It may have expired or been removed. Check it in Settings, then try again.">
          <button type="button" className="bk-ai-btn is-grow" onClick={actions.onSettings}>{`Check the ${name} key`}</button>
        </Card>
      );
    case 'ai-site-blocked':
      return (
        <Card
          title={`Briefkord can’t reach ${name} yet`}
          text={
            surface === 'brief'
              ? `Chrome needs your OK once so Briefkord can send this board to ${name}. Nothing else changes.`
              : `Chrome needs your OK once so Briefkord can send this board to ${name}. Nothing else changes.`
          }
        >
          <button type="button" className="bk-ai-btn is-primary" onClick={actions.onAskChrome}>Ask Chrome again</button>
          <button type="button" className="bk-ai-btn" onClick={actions.onPick}>Pick another provider</button>
        </Card>
      );
  }
}

export function SummaryNoText({ onRefresh, busy }: { onRefresh(): void; busy: boolean }) {
  return (
    <Card role="status" title="No page text to summarize" text="This link was saved as an address only. Refresh it from the page, then try again.">
      <button type="button" className="bk-ai-btn is-small" disabled={busy} onClick={onRefresh}>Refresh from the page</button>
    </Card>
  );
}

export function BriefEmptyBoard() {
  return <Card role="status" title="Add a few cards first" text="Brief me needs something to read." />;
}
