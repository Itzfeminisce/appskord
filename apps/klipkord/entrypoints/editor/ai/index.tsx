import { useEffect } from 'react';
import { LABELS } from '@/lib/project/ops';
import { steps, undo } from '@/lib/project/history';
import type { SlotProps } from '../components/slots';
import { setTimeline } from '../timeline/store';
import { C } from '../ui';
import { AskPanel } from './AskPanel';
import { stop } from './actions';
import { openAsk, setAi, subscribeAi, useAi } from './store';
import { TranslatePanel } from './TranslatePanel';
import { BUTTON } from './ui';

/** The inspector cover: Ask AI or Translate captions while open. */
function Cover(p: SlotProps) {
  const { panel } = useAi();
  if (panel === 'ask') return <AskPanel {...p} />;
  if (panel === 'translate') return <TranslatePanel {...p} />;
  return null;
}

/** StatesWork `ai-applied`: one Undo for the whole edit, and Ctrl+K to open Ask AI. */
function Overlay(p: SlotProps) {
  const { applied } = useAi();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openAsk(); }
    };
    addEventListener('keydown', onKey);
    // Leaving the editor stops a request; closing the panel lets it finish, since the draft waits.
    return () => { removeEventListener('keydown', onKey); stop(); };
  }, []);
  useEffect(() => {
    if (applied === null) return;
    const t = setTimeout(() => setAi({ applied: null }), 8000);
    return () => clearTimeout(t);
  }, [applied]);
  if (applied === null) return null;
  const label = LABELS.aiDraft(applied);
  const undoIt = () => {
    p.edit((q) => (steps(q).steps.at(-1)?.label === label ? undo(q) : q));
    setAi({ applied: null });
  };
  return (
    <div role="status" data-state="ai-applied" style={{
      position: 'fixed', left: '50%', bottom: 248, transform: 'translateX(-50%)', zIndex: 15, display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 8px 8px 14px', borderRadius: 10, background: C.raised, border: `1px solid ${C.line}`, color: C.text, fontSize: 13, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    }}>
      <span style={{ whiteSpace: 'nowrap' }}>AI edit applied · {applied} {applied === 1 ? 'change' : 'changes'}</span>
      <button type="button" onClick={undoIt} disabled={p.readOnly} style={{ ...BUTTON(false), flex: 'none', height: 28 }}>Undo</button>
      <button type="button" onClick={() => { setTimeline({ dialog: 'history' }); setAi({ applied: null }); }} style={{ ...BUTTON(false), flex: 'none', height: 28 }}>Show changes</button>
    </div>
  );
}

/** T15's part of the editor: Ask AI, Highlights, Translate captions and the AI toast. */
export const aiSlots = {
  topBar: () => ({ onAskAI: openAsk }),
  Cover,
  Overlay,
  subscribe: subscribeAi,
};
