import { useEffect, useState } from 'react';
import type { Card } from '@/lib/project/types';
import { CARD_TEMPLATES, capWords, cardSlots, cardTemplateName, type CardSlot, type CardTemplate } from '@/lib/render/layers/card';
import type { SlotProps } from '../components/slots';
import { Heading, Seg } from '../timeline/controls';
import { select } from '../timeline/store';
import { C } from '../ui';
import { addCard, changeCard, newCard } from './model';

/** Where each card goes, and the swatch, from the Cards frame. */
const CARD_TILES: Record<CardTemplate, { tag: string; swatch: string }> = {
  'title-hook': { tag: 'Start', swatch: 'linear-gradient(160deg, #FFFFFF, #E2E8F0)' },
  'end-card': { tag: 'Finish', swatch: '#0F172A' },
  'logo-sting': { tag: '1.5 s', swatch: 'radial-gradient(circle, #2563EB 0 18%, #F1F5F9 19%)' },
};
const PACKS = [{ value: 'clean', label: 'Clean' }, { value: 'bold', label: 'Bold' }, { value: 'playful', label: 'Playful' }] as const;

/** Title hook, End card and Logo sting. A title hook or end card already in the cut is opened rather than added twice. */
export function CardPicker({ p, active }: { p: SlotProps; active: Card | undefined }) {
  const pick = (template: CardTemplate) => {
    const have = template !== 'logo-sting' ? p.cut.cards.find((c) => c.template === template) : undefined;
    if (have) return select({ kind: 'cards', ids: [have.id] });
    if (p.readOnly) return;
    const card = newCard(p.cut, template, p.out, p.length, p.recording.title);
    p.edit((q) => addCard(q, card));
    select({ kind: 'cards', ids: [card.id] });
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
      {CARD_TEMPLATES.map((t) => (
        <button key={t} type="button" onClick={() => pick(t)} aria-pressed={active?.template === t}
          style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 6, borderRadius: 10, background: C.ground, border: `1.5px solid ${active?.template === t ? C.accentText : C.line}`, color: C.text, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
          <span aria-hidden="true" style={{ height: 62, borderRadius: 6, position: 'relative', overflow: 'hidden', background: CARD_TILES[t].swatch }} />
          <span style={{ fontSize: 12, fontWeight: 600, padding: '0 2px' }}>{cardTemplateName(t)}</span>
          <span style={{ fontSize: 11, color: C.muted, padding: '0 2px 2px' }}>{CARD_TILES[t].tag}</span>
        </button>
      ))}
    </div>
  );
}

/** One slot's words; capped at its limit and saved as one Undo step when the field is left. */
function SlotField({ card, slot, edit, readOnly }: { card: Card; slot: CardSlot; edit: (patch: Partial<Card>) => void; readOnly: boolean }) {
  const saved = card.slots[slot.id] ?? '';
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [card.id, saved]);
  const commit = () => {
    const next = value.trim();
    if (next === saved) return;
    const slots = { ...card.slots };
    if (next) slots[slot.id] = next;
    else delete slots[slot.id];
    edit({ slots });
  };
  const id = `card-${card.id}-${slot.id}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={id} style={{ fontSize: 11.5, color: C.secondary }}>{slot.optional ? `${slot.name} · optional` : `${slot.name} · ${slot.words} words max`}</label>
      <input id={id} value={value} readOnly={readOnly} onChange={(e) => setValue(capWords(e.target.value, slot.words))} onBlur={commit}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); }}
        style={{ height: 34, borderRadius: 8, border: `1px solid ${C.line}`, background: C.ground, color: C.text, padding: '0 10px', fontFamily: 'inherit', fontSize: 13 }} />
    </div>
  );
}

/** The chosen card's slots and style pack (Cards frame). */
export function CardFields({ p, card }: { p: SlotProps; card: Card }) {
  const edit = (patch: Partial<Omit<Card, 'id'>>) => { if (!p.readOnly) p.edit((q) => changeCard(q, card.id, patch)); };
  // Headline first, as the frame lists it, then the other slots in the template's order.
  const slots = cardSlots(card.template).sort((a, b) => Number(a.optional) - Number(b.optional));
  return (
    <>
      <Heading>{cardTemplateName(card.template)}</Heading>
      {slots.map((s) => <SlotField key={`${card.id}-${s.id}`} card={card} slot={s} edit={edit} readOnly={p.readOnly} />)}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: C.secondary, flexGrow: 1 }}>Style pack</span>
        <Seg label="Style pack" options={PACKS} value={card.pack} disabled={p.readOnly} onChange={(pack) => { if (pack !== card.pack) edit({ pack }); }} />
      </div>
    </>
  );
}
