/** Frames Main, PanelEmpty, StatesPanel and the panel states of StatesMore. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cardLabel } from '@/lib/board/label';
import type { Board, Card } from '@/lib/board/types';
import { targetSection } from '@/lib/capture/cards';
import type { Notice } from '@/lib/capture/intent';
import { previewImage, saveLinkOnly, saveNote, savePage, type SaveResult } from '@/lib/capture/save';
import { ago, formatBytes, isChromePage, siteName } from '@/lib/capture/text';
import { saveSettings } from '@/lib/store/settings';
import { openBoardTab, usePanel, type ActiveTab } from '../data';
import { BoardIcon, ChevronDown, FileIcon, ImageIcon, LinkIcon, ListIcon, NoteIcon, OpenIcon, PlusIcon, SpinnerIcon, WindowIcon } from '../icons';
import { HomeHeader, plural, useDismiss, useGo } from '../ui';

type TabKind = 'loading' | 'no-access' | 'chrome' | 'page';

const tabKind = (tab?: ActiveTab): TabKind => (!tab ? 'loading' : tab.restricted || (tab.url && isChromePage(tab.url)) ? 'chrome' : !tab.url ? 'no-access' : 'page');

/** A picture of the tab for the card, when Chrome lets Briefkord take one. */
function useTabPicture(tab: ActiveTab | undefined, on: boolean): string | undefined {
  const [picture, setPicture] = useState<string>();
  const key = `${tab?.id}|${tab?.url}|${tab?.status}`;
  useEffect(() => {
    setPicture(undefined);
    if (!tab || !on || tab.status === 'loading') return;
    let alive = true;
    let made: string | undefined;
    const timer = setTimeout(() => {
      void previewImage(tab).then((blob) => {
        if (!alive || !blob) return;
        made = URL.createObjectURL(blob);
        setPicture(made);
      });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
      if (made) URL.revokeObjectURL(made);
    };
  }, [key, on]);
  return picture;
}

function BoardPicker({ board }: { board: Board }) {
  const go = useGo();
  const count = Object.keys(board.cards).length;
  return (
    <button type="button" className="p-picker" onClick={() => go('/boards')}>
      {count > 0 && (
        <span className="p-picker-mark" aria-hidden="true">
          <BoardIcon />
        </span>
      )}
      <span className="p-picker-text">
        <span className="p-picker-label">Saving to</span>
        <span className="p-picker-name">{board.name}</span>
      </span>
      <span className="p-count">{plural(count, 'card')}</span>
      <ChevronDown stroke="var(--bk-text-2)" />
    </button>
  );
}

export function StorageLow({ used, free }: { used: number; free: number }) {
  const go = useGo();
  const share = used + free > 0 ? Math.round((used / (used + free)) * 100) : 100;
  return (
    <div role="alert" className="p-alert is-warn" style={{ gap: 8 }}>
      <span className="p-alert-title">This computer is almost out of space</span>
      <span className="p-alert-text">Boards open and edit as usual. New images and files can’t be added until there is more room.</span>
      <div className="p-alert-bar">
        <span style={{ width: `${share}%` }} />
      </div>
      <span className="p-alert-figures">
        Briefkord uses {formatBytes(used)} · {formatBytes(free)} free
      </span>
      <button type="button" className="p-alert-action" onClick={() => go('/settings', { show: 'storage' })}>
        See what takes space
      </button>
    </div>
  );
}

function NoticeAlert({ notice, onLinkSaved }: { notice: Notice; onLinkSaved: (result: SaveResult) => void }) {
  const [busy, setBusy] = useState(false);
  if (notice.kind === 'file-too-big')
    return (
      <div role="alert" className="p-alert is-error">
        <span className="p-alert-title">
          “{notice.name}” is {formatBytes(notice.bytes)}
        </span>
        <span className="p-alert-text">Files can be up to 50 MB, so the view file still opens fast. Add a smaller copy, or save a link to where it lives.</span>
      </div>
    );
  if (notice.kind !== 'image-blocked') return null;
  const saveLink = async () => {
    setBusy(true);
    const tab = { id: notice.tabId, windowId: (await browser.tabs.get(notice.tabId).catch(() => undefined))?.windowId ?? -1 };
    let result = await savePage(tab, notice.boardId);
    if (!result.ok && result.problem === 'cant-read' && notice.pageUrl) result = await saveLinkOnly({ url: notice.pageUrl, title: notice.pageTitle ?? '' }, notice.boardId);
    setBusy(false);
    onLinkSaved(result);
  };
  return (
    <>
      <div role="alert" className="p-alert is-error">
        <span className="p-alert-title">This site didn’t let Briefkord copy the image</span>
        <span className="p-alert-text">Save the page as a link instead, or take a screenshot and drop it on the board.</span>
      </div>
      <div className="p-after-alert">
        <button type="button" className="p-btn is-small" disabled={busy} onClick={() => void saveLink()}>
          Save the page as a link
        </button>
      </div>
    </>
  );
}

function SectionPicker({ board, sectionId }: { board: Board; sectionId: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const current = board.sections.find((s) => s.id === sectionId);
  return (
    <>
      <button type="button" className="p-section-btn" aria-label="Choose a section" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{current?.title}</span>
        <ChevronDown size={14} stroke="var(--bk-text-2)" />
      </button>
      {open && (
        <div ref={ref} role="menu" className="p-menu" style={{ right: 14, bottom: 'calc(100% - 8px)' }}>
          {board.sections.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="menuitem"
              className={`p-menu-item${s.id === sectionId ? ' is-on' : ''}`}
              onClick={() => {
                void saveSettings({ lastSectionId: s.id });
                close();
              }}
            >
              <span className="p-menu-num">{i + 1}</span>
              {s.title}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'cant-read'; noAccess: boolean } | { kind: 'error' };

// activeTab covers only the tab the panel opened on; a click on the icon or the shortcut grants the tab in front.
const SHORTCUT_HINT = <p className="p-hint is-shortcut">Press Alt+Shift+S or click the Briefkord icon to save this tab.</p>;

function TabCard({ board, sectionId, compact, onSaved }: { board: Board; sectionId: string; compact: boolean; onSaved: (result: SaveResult) => void }) {
  const { tab } = usePanel();
  const kind = tabKind(tab);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const picture = useTabPicture(tab, kind === 'page' && state.kind === 'idle');
  const tabKey = `${tab?.id}|${tab?.url}`;
  const lastKey = useRef(tabKey);
  if (lastKey.current !== tabKey) {
    lastKey.current = tabKey;
    if (state.kind !== 'idle' && state.kind !== 'saving') setState({ kind: 'idle' });
  }

  const save = async () => {
    if (!tab) return;
    setState({ kind: 'saving' });
    const result = await savePage(tab, board.id, sectionId);
    if (!result.ok && result.problem === 'cant-read') return setState({ kind: 'cant-read', noAccess: result.reason === 'no-access' });
    setState(result.ok ? { kind: 'idle' } : { kind: 'error' });
    onSaved(result);
  };
  const saveLink = async () => {
    if (!tab?.url) return;
    setState({ kind: 'saving' });
    const result = await saveLinkOnly({ url: tab.url, title: tab.title ?? '' }, board.id, sectionId);
    setState(result.ok ? { kind: 'idle' } : { kind: 'error' });
    onSaved(result);
  };

  if (kind === 'chrome')
    return <div className="p-alert is-quiet">This tab is a Chrome page, so there’s nothing to save from it. Open a website, or add a note instead.</div>;

  if (kind === 'no-access')
    return (
      <>
        <div role="alert" className="p-alert is-warn">
          <span className="p-alert-title">Chrome doesn’t let Briefkord read this page</span>
        </div>
        {SHORTCUT_HINT}
      </>
    );

  if (state.kind === 'saving')
    return (
      <section aria-label="This tab" aria-busy="true" className="p-tab">
        <div className="p-skeleton" />
        <div className="p-skeleton-lines">
          <span />
          <span />
        </div>
        <div className="p-tab-actions">
          <div className="p-btn is-primary is-busy" style={{ flexGrow: 1 }}>
            <SpinnerIcon />
            Saving the page…
          </div>
        </div>
      </section>
    );

  if (state.kind === 'cant-read' && tab?.url)
    return (
      <>
        <section aria-label="This tab" className="p-tab" style={{ boxShadow: 'none' }}>
          <div className="p-tab-blank">
            <WindowIcon />
          </div>
          <div className="p-tab-body" style={{ paddingBottom: 12 }}>
            <span className="p-tab-title">{tab.title || siteName(tab.url)}</span>
            <span className="p-tab-site">{tab.url}</span>
          </div>
        </section>
        <div role="alert" className="p-alert is-warn">
          <span className="p-alert-title">Chrome doesn’t let Briefkord read this page</span>
          <span className="p-alert-text">It can still save the address and title as a link card.</span>
        </div>
        <div className="p-after-alert">
          <button type="button" className="p-btn is-primary" onClick={() => void saveLink()}>
            Save as a link only
          </button>
        </div>
        {state.noAccess && SHORTCUT_HINT}
      </>
    );

  const title = tab?.title || (tab?.url ? siteName(tab.url) : '');
  const site = tab?.url ? siteName(tab.url) : '';
  if (compact)
    return (
      <section aria-label="This tab" className="p-tab is-ready">
        <div className="p-tab-compact">
          <span className="p-tab-thumb" aria-hidden="true">
            {picture && <img src={picture} alt="" />}
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span className="p-tab-title">{title}</span>
            <span className="p-tab-site">{site}</span>
          </span>
        </div>
        <div className="p-tab-actions">
          <button type="button" className="p-btn is-primary" disabled={kind !== 'page'} onClick={() => void save()}>
            Save this page
          </button>
        </div>
      </section>
    );

  return (
    <section aria-label="This tab" className="p-tab">
      <div className="p-tab-preview">
        {picture ? (
          <img src={picture} alt="" />
        ) : (
          <div className="p-tab-bars" aria-hidden="true">
            <span />
            <span />
          </div>
        )}
        <span className="p-tab-badge">This tab</span>
      </div>
      <div className="p-tab-body">
        <span className="p-tab-title">{title}</span>
        <span className="p-tab-site">{site} · page text, title and preview are saved</span>
      </div>
      <div className="p-tab-actions">
        <button type="button" className="p-btn is-primary" disabled={kind !== 'page'} onClick={() => void save()}>
          <PlusIcon />
          <span>Save this page</span>
        </button>
        <SectionPicker board={board} sectionId={sectionId} />
      </div>
    </section>
  );
}

function QuickNote({ board, sectionId }: { board: Board; sectionId: string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const result = await saveNote(text, board.id, sectionId);
    setBusy(false);
    if (result.ok) setText('');
    else console.error('Briefkord: could not add the note', result);
  };
  return (
    <form
      className="p-field"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <label htmlFor="quick-note" className="p-label">
        Quick note
      </label>
      <div className="p-row">
        <input id="quick-note" className="p-input" type="text" placeholder="Ask Sam about the coupon field" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="p-btn is-small" style={{ fontWeight: 600 }} disabled={busy}>
          Add
        </button>
      </div>
    </form>
  );
}

const KIND_NAME: Record<Card['kind'], string> = { link: 'Link', image: 'Image', note: 'Note', file: 'File', checklist: 'Checklist', diagram: 'Diagram' };

function KindMark({ kind }: { kind: Card['kind'] }) {
  if (kind === 'image')
    return (
      <span className="p-kind is-image" aria-hidden="true">
        <ImageIcon />
      </span>
    );
  if (kind === 'note')
    return (
      <span className="p-kind is-note" aria-hidden="true">
        <NoteIcon />
      </span>
    );
  if (kind === 'link')
    return (
      <span className="p-kind" aria-hidden="true">
        <LinkIcon size={15} />
      </span>
    );
  return (
    <span className="p-kind is-other" aria-hidden="true">
      {kind === 'file' ? <FileIcon /> : <ListIcon />}
    </span>
  );
}

function LastAdded({ board }: { board: Board }) {
  const newest = Object.values(board.cards)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 2);
  const now = Date.now();
  if (!newest.length) return null;
  return (
    <>
      <div className="p-list-head">
        <strong>Last added</strong>
        <span>Newest first</span>
      </div>
      <ul className="p-list">
        {newest.map((card) => (
          <li key={card.id} className="p-added">
            <KindMark kind={card.kind} />
            <span className="p-added-text">
              <span className="p-added-title">{cardLabel(card)}</span>
              <span className="p-added-meta">
                {KIND_NAME[card.kind]} · {ago(card.createdAt, now)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Main() {
  const { board, settings, storage, notice, setNotice } = usePanel();
  const go = useGo();
  if (!board || !settings) return <div className="panel" />;
  const section = targetSection(board, settings.lastSectionId);
  const empty = Object.keys(board.cards).length === 0;
  const onSaved = (result: SaveResult) => {
    setNotice(undefined);
    if (result.ok && result.card.kind === 'link') go(`/saved/${result.card.id}`, result.offline ? { offline: '1' } : {});
    else if (!result.ok) console.error('Briefkord: could not save the page', result);
  };

  return (
    <div className="panel">
      <HomeHeader />
      <div className="panel-scroll">
        <BoardPicker board={board} />
        {notice && <NoticeAlert notice={notice} onLinkSaved={onSaved} />}
        <TabCard board={board} sectionId={section.id} compact={empty} onSaved={onSaved} />
        {(storage?.low || notice?.kind === 'storage-low') && storage && <StorageLow used={storage.used} free={storage.free} />}
        {empty ? (
          <div className="p-ready">
            <strong>Your board is ready</strong>
            {['Save this page, or any page you open next.', 'Right-click an image or selected text to send it here.', 'Open the board to arrange it and add diagrams.'].map((tip, i) => (
              <span key={tip} className="p-tip">
                <span className="p-tip-num">{i + 1}</span>
                {tip}
              </span>
            ))}
          </div>
        ) : (
          <>
            <QuickNote board={board} sectionId={section.id} />
            <LastAdded board={board} />
          </>
        )}
      </div>
      <div className="p-footer">
        {empty ? (
          <button type="button" className="p-btn" onClick={() => openBoardTab(board.id)}>
            Open board
          </button>
        ) : (
          <>
            <button type="button" className="p-btn is-primary" onClick={() => openBoardTab(board.id)}>
              <span>Open board</span>
              <OpenIcon />
            </button>
            <p>Right-click an image or selected text to send it here too.</p>
          </>
        )}
      </div>
    </div>
  );
}
