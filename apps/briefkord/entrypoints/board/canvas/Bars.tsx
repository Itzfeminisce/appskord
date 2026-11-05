/** Floating black bars over the canvas: one card (CardSelected), several cards (CardMenu multi-select), an arrow and a group (CardEditing). */
import { useState } from 'react';
import { CARD_COLOURS, type Arrow, type Board, type Card, type CardColour, type Group } from '@/lib/board/types';
import { webUrl } from '../logic/cards';
import { More, Sparkle, Trash } from '../icons';

export interface BarActions {
  recolour(ids: string[], colour: CardColour): void;
  summarize(id: string): void;
  openPage(id: string): void;
  connect(id: string): void;
  more(id: string, x: number, y: number): void;
  deleteCards(ids: string[]): void;
  group(ids: string[]): void;
  lineUp(ids: string[]): void;
  moveToSection(ids: string[], sectionId: string): void;
  setArrowDashed(id: string, dashed: boolean): void;
  deleteArrow(id: string): void;
  ungroup(id: string): void;
  renameGroup(id: string, title: string): void;
}

export const COLOUR_NAME: Record<CardColour, string> = { white: 'White', yellow: 'Yellow', teal: 'Teal', blue: 'Blue', rose: 'Rose' };

export function Swatches({ value, onPick }: { value?: CardColour; onPick(colour: CardColour): void }) {
  return (
    <span className="bk-swatches" role="radiogroup" aria-label="Colour">
      {CARD_COLOURS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={COLOUR_NAME[c]} className={`bk-swatch bk-sw-${c}`} onClick={() => onPick(c)} />
      ))}
    </span>
  );
}

const pageOf = (card: Card): string | undefined => webUrl(card.kind === 'link' ? card.url : card.kind === 'image' ? card.pageUrl : undefined);

export function CardBar({ card, actions, connecting }: { card: Card; actions: BarActions; connecting: boolean }) {
  return (
    <div role="toolbar" aria-label="Card actions" className="bk-bar" data-canvas-control="" onPointerDown={(e) => e.stopPropagation()}>
      <Swatches value={card.colour} onPick={(c) => actions.recolour([card.id], c)} />
      <span className="bk-bar-line" aria-hidden="true" />
      {card.kind === 'link' && (
        <button type="button" onClick={() => actions.summarize(card.id)}><span className="bk-accent-dark"><Sparkle size={14} small /></span>Summarize</button>
      )}
      {pageOf(card) && <button type="button" onClick={() => actions.openPage(card.id)}>Open page</button>}
      <button type="button" aria-pressed={connecting} onClick={() => actions.connect(card.id)}>Connect</button>
      <button type="button" className="bk-bar-icon" aria-label="More actions" onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        actions.more(card.id, box.left, box.bottom + 6);
      }}><More /></button>
      <span className="bk-bar-line" aria-hidden="true" />
      <button type="button" className="bk-bar-icon bk-bar-danger" aria-label="Delete card" onClick={() => actions.deleteCards([card.id])}><Trash /></button>
    </div>
  );
}

export function MultiBar({ ids, board, actions }: { ids: string[]; board: Board; actions: BarActions }) {
  const [open, setOpen] = useState<'colour' | 'section' | null>(null);
  const toggle = (what: 'colour' | 'section') => setOpen((o) => (o === what ? null : what));
  const label = `${ids.length} cards selected`;
  return (
    <div className="bk-bar-wrap" data-canvas-control="" onPointerDown={(e) => e.stopPropagation()}>
      <div role="toolbar" aria-label={label} className="bk-bar bk-bar-sm">
        <span className="bk-bar-count">{label}</span>
        <span className="bk-bar-line" aria-hidden="true" />
        <button type="button" aria-expanded={open === 'colour'} onClick={() => toggle('colour')}>Colour</button>
        <button type="button" onClick={() => actions.group(ids)}>Group</button>
        <button type="button" onClick={() => actions.lineUp(ids)}>Line up</button>
        <button type="button" aria-expanded={open === 'section'} onClick={() => toggle('section')}>Move to section</button>
        <button type="button" className="bk-bar-icon bk-bar-danger" aria-label={`Delete ${ids.length} cards`} onClick={() => actions.deleteCards(ids)}><Trash /></button>
      </div>
      {open === 'colour' && (
        <div className="bk-pop bk-pop-dark"><Swatches onPick={(c) => (actions.recolour(ids, c), setOpen(null))} /></div>
      )}
      {open === 'section' && (
        <div className="bk-pop" role="menu">
          {board.sections.map((s, i) => (
            <button key={s.id} type="button" role="menuitem" onClick={() => (actions.moveToSection(ids, s.id), setOpen(null))}>{i + 1} · {s.title}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ArrowBarProps { arrow: Arrow; actions: BarActions; labelling: boolean; onLabel(): void; onBoth(both: boolean): void }

export function ArrowBar({ arrow, actions, labelling, onLabel, onBoth }: ArrowBarProps) {
  return (
    <div role="toolbar" aria-label="Arrow" className="bk-bar bk-bar-xs" data-canvas-control="" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" aria-pressed={labelling} onClick={onLabel}>Label</button>
      <button type="button" aria-pressed={!arrow.dashed} onClick={() => actions.setArrowDashed(arrow.id, false)}>Solid</button>
      <button type="button" aria-pressed={!!arrow.dashed} onClick={() => actions.setArrowDashed(arrow.id, true)}>Dashed</button>
      <button type="button" aria-pressed={!!arrow.both} onClick={() => onBoth(!arrow.both)}>Both ends</button>
      <button type="button" className="bk-bar-icon bk-bar-danger" aria-label="Delete arrow" onClick={() => actions.deleteArrow(arrow.id)}><Trash size={15} /></button>
    </div>
  );
}

/** CardEditing group-selected colours: no colour is the default teal, white draws grey. */
const GROUP_COLOURS: { colour: CardColour | undefined; name: string; swatch: string }[] = [
  { colour: undefined, name: 'Teal', swatch: 'teal' },
  { colour: 'blue', name: 'Blue', swatch: 'blue' },
  { colour: 'white', name: 'Grey', swatch: 'grey' },
];

export function GroupBar({ group, actions, onColour }: { group: Group; actions: BarActions; onColour(colour: CardColour | undefined): void }) {
  const current = group.colour === 'teal' ? undefined : group.colour;
  return (
    <div role="toolbar" aria-label="Group" className="bk-bar bk-bar-xs bk-bar-group" data-canvas-control="" onPointerDown={(e) => e.stopPropagation()}>
      <span className="bk-swatches bk-swatches-sm" role="radiogroup" aria-label="Colour">
        {GROUP_COLOURS.map(({ colour, name, swatch }) => (
          <button key={name} type="button" role="radio" aria-checked={current === colour} aria-label={name} className={`bk-swatch bk-sw-${swatch}`} onClick={() => onColour(colour)} />
        ))}
      </span>
      <button type="button" onClick={() => actions.ungroup(group.id)}>Ungroup</button>
    </div>
  );
}

/** The class that draws a group in its colour. */
export const groupClass = (group: Group): string => `bk-group-${group.colour === 'blue' ? 'blue' : group.colour === 'white' ? 'grey' : 'teal'}`;
