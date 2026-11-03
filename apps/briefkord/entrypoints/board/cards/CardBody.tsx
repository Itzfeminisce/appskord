/** What each kind of card shows on the canvas, with its number badge. Notes and checklists also edit in place. */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { newId } from '@/lib/board/ops';
import type { Card, ChecklistCard, ChecklistItem, DiagramCard, FileCard, ImageCard, LinkCard, NoteCard } from '@/lib/board/types';
import { formatBytes } from '../logic/drop';
import { KIND_LABEL } from '../logic/cards';
import { DiagramView } from './DiagramView';
import { useFileUrl } from './useFileUrl';

export interface CardBodyProps {
  card: Card;
  number?: number;
  boardId: string;
  editing: boolean;
  /** One undo step. */
  onCommit(next: Card): void;
  onDone(): void;
}

export function Badge({ n }: { n?: number }) {
  return n ? <span className="bk-badge">{n}</span> : null;
}

export function CardBody(props: CardBodyProps) {
  switch (props.card.kind) {
    case 'link':
      return <LinkBody {...props} card={props.card} />;
    case 'image':
      return <ImageBody {...props} card={props.card} />;
    case 'note':
      return <NoteBody {...props} card={props.card} />;
    case 'checklist':
      return <ChecklistBody {...props} card={props.card} />;
    case 'file':
      return <FileBody {...props} card={props.card} />;
    case 'diagram':
      return <DiagramBody {...props} card={props.card} />;
  }
}

function LinkBody({ card, number, boardId }: CardBodyProps & { card: LinkCard }) {
  const preview = useFileUrl(boardId, card.preview?.id);
  return (
    <>
      <div className="bk-card-media bk-link-media" style={{ height: '48%' }}>
        {preview && <img src={preview} alt="" draggable={false} />}
        <span className="bk-badge-at"><Badge n={number} /></span>
      </div>
      <div className="bk-card-text">
        <span className="bk-site">{card.site}</span>
        <span className="bk-card-title">{card.title}</span>
        {card.say && <span className="bk-card-say">{card.say}</span>}
      </div>
    </>
  );
}

function ImageBody({ card, number, boardId }: CardBodyProps & { card: ImageCard }) {
  const url = useFileUrl(boardId, card.file.id);
  return (
    <>
      <div className="bk-card-media bk-image-media">
        {url && <img src={url} alt={card.title} draggable={false} />}
        <span className="bk-badge-at"><Badge n={number} /></span>
      </div>
      <div className="bk-card-text bk-image-title"><span className="bk-card-title">{card.title}</span></div>
    </>
  );
}

function NoteBody({ card, number, editing, onCommit, onDone }: CardBodyProps & { card: NoteCard }) {
  const [title, setTitle] = useState(card.title);
  const [text, setText] = useState(card.text);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const draft = useRef({ title, text });
  draft.current = { title, text };
  useEffect(() => {
    if (!editing) return;
    setTitle(card.title);
    setText(card.text);
    const el = textRef.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
    return () => {
      const d = draft.current;
      if (d.title !== card.title || d.text !== card.text) onCommit({ ...card, title: d.title, text: d.text });
    };
    // Commits once, when editing ends.
  }, [editing]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onDone();
    }
  };
  if (editing) {
    return (
      <div className="bk-note bk-editing-body" onKeyDown={onKey}>
        <span className="bk-row"><Badge n={number} /><input className="bk-note-title bk-bare" value={title} aria-label="Title" onChange={(e) => setTitle(e.target.value)} /></span>
        <textarea ref={textRef} className="bk-note-text bk-bare" value={text} aria-label="Note" onChange={(e) => setText(e.target.value)} />
        <span className="bk-edit-hint">Esc or click outside to finish</span>
      </div>
    );
  }
  return (
    <div className="bk-note">
      {(number || card.title) && <span className="bk-row"><Badge n={number} />{card.title && <span className="bk-note-title">{card.title}</span>}</span>}
      <span className="bk-note-text">{card.text}</span>
    </div>
  );
}

function ChecklistBody({ card, number, editing, onCommit, onDone }: CardBodyProps & { card: ChecklistCard }) {
  const [items, setItems] = useState<ChecklistItem[]>(card.items);
  const [title, setTitle] = useState(card.title);
  const [adding, setAdding] = useState('');
  const dragFrom = useRef<number | null>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const draft = useRef({ items, title, adding });
  draft.current = { items, title, adding };
  useEffect(() => {
    if (!editing) return;
    setItems(card.items);
    setTitle(card.title);
    setAdding('');
    addRef.current?.focus();
    return () => {
      const d = draft.current;
      const next = d.adding.trim() ? [...d.items, { id: newId(), text: d.adding.trim(), done: false }] : d.items;
      const cleaned = next.filter((i) => i.text.trim() !== '');
      // The card grows to show every item; it never shrinks on its own.
      const h = Math.max(card.rect.h, 52 + 25 * cleaned.length);
      if (d.title !== card.title || JSON.stringify(cleaned) !== JSON.stringify(card.items)) onCommit({ ...card, title: d.title, items: cleaned, rect: { ...card.rect, h } });
    };
  }, [editing]);

  const shown = editing ? items : card.items;
  const done = shown.filter((i) => i.done).length;
  const toggle = (id: string) => {
    if (editing) setItems((list) => list.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
    else onCommit({ ...card, items: card.items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)) });
  };
  const onAddKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && adding.trim()) {
      setItems((list) => [...list, { id: newId(), text: adding.trim(), done: false }]);
      setAdding('');
    }
  };
  const drop = (to: number) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from === null || from === to) return;
    setItems((list) => {
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  };

  return (
    <div className="bk-checklist" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onDone())}>
      <span className="bk-row">
        <Badge n={number} />
        {editing ? <input className="bk-card-title bk-bare bk-grow" value={title} aria-label="Title" onChange={(e) => setTitle(e.target.value)} /> : <span className="bk-card-title bk-grow">{card.title}</span>}
        <span className="bk-mono-count">{done}/{shown.length}</span>
      </span>
      {shown.map((item, i) => (
        <label
          key={item.id}
          className={item.done ? 'bk-check is-done' : 'bk-check'}
          draggable={editing}
          onDragStart={() => (dragFrom.current = i)}
          onDragOver={(e) => editing && e.preventDefault()}
          onDrop={() => drop(i)}
        >
          <input type="checkbox" checked={item.done} onChange={() => toggle(item.id)} />
          {editing ? (
            <input className="bk-bare bk-grow" value={item.text} aria-label={item.text} onChange={(e) => setItems((list) => list.map((x) => (x.id === item.id ? { ...x, text: e.target.value } : x)))} />
          ) : (
            <span>{item.text}</span>
          )}
        </label>
      ))}
      {editing && (
        <>
          <input ref={addRef} className="bk-add-item" type="text" aria-label="Add an item" placeholder="Add an item" value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={onAddKey} />
          <span className="bk-hint-sm">Enter adds the next one. Drag an item to reorder.</span>
        </>
      )}
    </div>
  );
}

function FileBody({ card, number }: CardBodyProps & { card: FileCard }) {
  const ext = (card.file.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'file').toUpperCase().slice(0, 4);
  const details = [formatBytes(card.file.size), card.pages ? `${card.pages} pages` : ''].filter(Boolean).join(' · ');
  return (
    <div className="bk-file">
      <span className={ext === 'PDF' ? 'bk-file-icon is-pdf' : 'bk-file-icon'} aria-hidden="true">{ext}</span>
      <span className="bk-file-text">
        <span className="bk-row"><Badge n={number} /></span>
        <span className="bk-card-title">{card.title}</span>
        <span className="bk-mono-small">{details}</span>
      </span>
    </div>
  );
}

function DiagramBody({ card, number }: CardBodyProps & { card: DiagramCard }) {
  return (
    <>
      <header className="bk-diagram-head">
        <Badge n={number} />
        <span className="bk-card-title bk-grow">{card.title}</span>
        <span className="bk-kind">{KIND_LABEL.diagram}</span>
      </header>
      <div className="bk-diagram-body">
        <DiagramView diagram={card.diagram} />
      </div>
    </>
  );
}
