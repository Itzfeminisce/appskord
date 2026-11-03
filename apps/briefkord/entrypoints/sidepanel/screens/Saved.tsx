/** Frame PanelSaved, plus StatesMore `offline-save`. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { moveCardInList, sectionOf, updateCard } from '@/lib/board/ops';
import type { LinkCard } from '@/lib/board/types';
import { removeCard } from '@/lib/capture/save';
import { formatCount } from '@/lib/capture/text';
import { readFile } from '@/lib/store/files';
import { editBoard, openBoardTab, usePanel } from '../data';
import { CheckIcon, ChevronDown, LinkIcon, SparkIcon } from '../icons';
import { BackHeader, useDismiss, useFileUrl, useGo } from '../ui';

/** What the card holds, said as the frame says it. */
function keptLine(card: LinkCard): string {
  const words = `${formatCount(card.words)} words of page text`;
  if (card.preview && card.words) return `Title, preview and ${words} saved on this computer.`;
  if (card.words) return `Title and ${words} saved on this computer.`;
  if (card.preview) return 'Title and preview saved on this computer.';
  return 'Title and address saved on this computer.';
}

export function Saved({ cardId, offline }: { cardId: string; offline: boolean }) {
  const { board, loaded } = usePanel();
  const go = useGo();
  const card = board?.cards[cardId];
  const link = card?.kind === 'link' ? card : undefined;
  const [say, setSay] = useState(card?.say ?? '');
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  const menuRef = useDismiss(menu, closeMenu);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const preview = useFileUrl(board && link?.preview ? () => readFile(board.id, link.preview!.id) : undefined, link?.preview?.id);

  const seen = useRef(false);
  useEffect(() => {
    // The panel may not have reloaded the board yet; leave only when the card was here and went (undone elsewhere).
    if (card && !seen.current) {
      seen.current = true;
      setSay(card.say);
    }
    if (loaded && seen.current && !card) go('/');
  }, [loaded, card, go]);
  if (!board || !link) return <div className="panel" />;

  const boardId = board.id;
  const section = sectionOf(board, cardId);
  const sectionIndex = section ? board.sections.indexOf(section) + 1 : 0;
  const storeSay = (text: string) => {
    clearTimeout(timer.current);
    void editBoard(boardId, (b) => updateCard(b, cardId, Date.now(), (c) => (c.say === text ? c : { ...c, say: text }))).catch((error: unknown) =>
      console.error('Briefkord: could not save what to say', error),
    );
  };

  return (
    <div className="panel">
      <BackHeader title="Saved" />
      <div className="panel-scroll">
        <div role="status" className="p-status">
          <span className="p-status-check" aria-hidden="true">
            <CheckIcon stroke="var(--bk-card)" />
          </span>
          <span className="p-status-text">
            Added to <strong>{board.name}</strong>
          </span>
          <button
            type="button"
            className="p-link-btn"
            onClick={() => {
              clearTimeout(timer.current);
              void removeCard(boardId, cardId).then(() => go('/'));
            }}
          >
            Undo
          </button>
        </div>

        <article className="p-saved-card">
          <div className="p-saved-preview">{preview && <img src={preview} alt="" />}</div>
          <div className="p-saved-body">
            <span className="p-saved-kind">
              <LinkIcon />
              Link · {link.site}
            </span>
            <span className="p-tab-title">{link.title}</span>
            <span className="p-saved-note">{keptLine(link)}</span>
          </div>
        </article>
        {offline && !link.preview && (
          <div role="status" className="p-offline">
            You’re offline, so the page title and text were saved but the preview image wasn’t. Briefkord adds it when you’re back online.
          </div>
        )}
        {offline && !link.preview && <p className="p-offline-note">Boards work offline. Only AI actions and page refresh need a connection.</p>}

        <div className="p-field" style={{ marginTop: 14, position: 'relative' }}>
          <label htmlFor="section" className="p-label">
            Section in the list
          </label>
          <button id="section" type="button" className="p-select" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <span>
              {sectionIndex} · {section?.title}
            </span>
            <ChevronDown size={14} stroke="var(--bk-text-2)" />
          </button>
          {menu && (
            <div ref={menuRef} role="menu" className="p-menu" style={{ left: 0, right: 0, width: 'auto', top: 'calc(100% + 4px)' }}>
              {board.sections.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  role="menuitem"
                  className={`p-menu-item${s.id === section?.id ? ' is-on' : ''}`}
                  onClick={() => {
                    closeMenu();
                    if (s.id === section?.id) return;
                    void editBoard(boardId, (b) => moveCardInList(b, cardId, s.id, b.sections.find((x) => x.id === s.id)!.cards.length, Date.now()));
                  }}
                >
                  <span className="p-menu-num">{i + 1}</span>
                  {s.title}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="p-field">
          <label htmlFor="talk" className="p-label">
            What to say about it
          </label>
          <textarea
            id="talk"
            rows={2}
            className="p-textarea"
            placeholder="Shown beside this card in meeting mode"
            value={say}
            onChange={(e) => {
              const text = e.target.value;
              setSay(text);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => storeSay(text), 600);
            }}
            onBlur={() => storeSay(say)}
          />
        </div>

        <button type="button" className="p-summarize" onClick={() => openBoardTab(boardId, { card: cardId, summarize: '1' })}>
          <SparkIcon stroke="var(--bk-accent)" />
          <span className="p-summarize-text">
            <strong>Summarize this page</strong>
            <span>Adds a short summary card next to it</span>
          </span>
        </button>
      </div>
      <div className="p-footer is-row">
        <button type="button" className="p-btn is-grow" onClick={() => go('/')}>
          Done
        </button>
        <button type="button" className="p-btn is-primary is-grow" onClick={() => openBoardTab(boardId, { card: cardId })}>
          Show on board
        </button>
      </div>
    </div>
  );
}
