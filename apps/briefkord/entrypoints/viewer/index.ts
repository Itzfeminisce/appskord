// The view file renderer. It is inlined into a standalone HTML page, so it imports only types and pure helpers that bundle in.
import { cardLabel } from '../../lib/board/label';
import type { Board, Card, Diagram, Rect, Section } from '../../lib/board/types';
import { routeEdge } from '../../lib/diagram/route';
import { fitNodes, labelRoom, LINE_HEIGHT, nodeLines } from '../../lib/diagram/size';
import { formatBytes, formatDay } from '../../lib/share/prepare';

type Files = Record<string, string>;
interface Meta { at: number }
interface Entry { card: Card; n: number; section: Section; sectionIndex: number }

const SVG = 'http://www.w3.org/2000/svg';
const REPO = 'https://github.com/Itzfeminisce/appskord';
const KIND: Record<Card['kind'], string> = { link: 'Link', image: 'Image', note: 'Note', file: 'File', checklist: 'Checklist', diagram: 'Diagram' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function svg(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function icon(size: number, paths: string[], filled = false, colour = 'currentColor'): SVGElement {
  const root = svg('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: filled ? colour : 'none', 'aria-hidden': 'true' });
  if (!filled) for (const [k, v] of Object.entries({ stroke: colour, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) root.setAttribute(k, String(v));
  for (const d of paths) root.append(d.startsWith('circle') ? svg('circle', { cx: 12, cy: 12, r: 3 }) : svg('path', { d }));
  return root;
}

const EYE = ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'circle'];
const PLAY = ['M7 4.5v15l12-7.5z'];
const PEN = ['M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'];
const LEFT = ['m14 6-6 6 6 6'];
const RIGHT = ['m10 6 6 6-6 6'];
const TICK = ['m5 12 5 5 9-10'];

function logo(): HTMLElement {
  const box = el('span', 'vf-logo');
  box.setAttribute('aria-hidden', 'true');
  const root = svg('svg', { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none' });
  for (const [x, y, w, h, teal] of [[4, 4, 7, 9, 0], [13, 4, 7, 5, 0], [13, 11, 7, 9, 1], [4, 15, 7, 5, 0]] as const) {
    const r = svg('rect', { x, y, width: w, height: h, rx: 2 });
    r.setAttribute('style', `fill: var(${teal ? '--bk-logo-teal' : '--bk-card'})`);
    root.append(r);
  }
  box.append(root);
  return box;
}

function readJson<T>(id: string): T | undefined {
  const text = document.getElementById(id)?.textContent;
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    console.error(`Briefkord: could not read the ${id} data`, error);
    return undefined;
  }
}

const safeHref = (url: string | undefined): string | undefined => (url && /^https?:\/\//i.test(url) ? url : undefined);
const hostOf = (url: string | undefined): string => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
};

function newTab(a: HTMLAnchorElement, href: string): HTMLAnchorElement {
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

let markers = 0;

// Where the line from a box's centre towards (tx, ty) leaves the box.
function edgePoint(b: { x: number; y: number; w: number; h: number }, tx: number, ty: number, pad = 0): [number, number] {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const s = Math.min(Math.abs((b.w / 2 + pad) / (dx || 1e-9)), Math.abs((b.h / 2 + pad) / (dy || 1e-9)));
  return [cx + dx * s, cy + dy * s];
}

function arrowHead(defs: SVGElement, cls: string): string {
  const id = `vf-head-${++markers}`;
  const marker = svg('marker', { id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
  marker.append(svg('path', { d: 'M0 0 10 5 0 10z', class: cls }));
  defs.append(marker);
  return `url(#${id})`;
}

function diagramSvg(diagram: Diagram, label: string): SVGElement {
  const pad = 16;
  const nodes = fitNodes(diagram).nodes;
  const box = nodes.length === 0 ? { x: 0, y: 0, w: 1, h: 1 } : (() => {
    const x = Math.min(...nodes.map((n) => n.x)) - pad, y = Math.min(...nodes.map((n) => n.y)) - pad;
    return { x, y, w: Math.max(...nodes.map((n) => n.x + n.w)) + pad - x, h: Math.max(...nodes.map((n) => n.y + n.h)) + pad - y };
  })();
  const root = svg('svg', { viewBox: `${box.x} ${box.y} ${box.w} ${box.h}`, class: 'vf-diagram', role: 'img', 'aria-label': `Diagram: ${label}`, preserveAspectRatio: 'xMidYMid meet' });
  const defs = svg('defs');
  root.append(defs);
  const head = arrowHead(defs, 'head');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of diagram.edges) {
    const a = byId.get(edge.from), b = byId.get(edge.to);
    if (!a || !b) continue;
    const route = routeEdge(a, b);
    root.append(svg('path', { d: route.d, class: 'edge', 'marker-end': head }));
    if (edge.label && route.label) {
      const t = svg('text', { x: route.label.x, y: route.label.y, 'text-anchor': route.label.anchor, class: 'edge-label' });
      t.textContent = edge.label;
      root.append(t);
    }
  }
  for (const node of nodes) {
    const { x, y, w, h } = node;
    const cx = x + w / 2, cy = y + h / 2;
    if (node.kind === 'choice') root.append(svg('path', { d: `M${cx} ${y + 2}L${x + w - 2} ${cy}L${cx} ${y + h - 2}L${x + 2} ${cy}z`, class: `node ${node.colour}` }));
    else if (node.kind !== 'text') root.append(svg('rect', { x: x + 0.75, y: y + 0.75, width: w - 1.5, height: h - 1.5, rx: 8, class: `node ${node.colour}` }));
    const text = svg('text', { x: cx, y: cy, 'data-room': labelRoom(node), class: `node-label ${node.colour}${node.kind === 'choice' ? ' choice' : ''}${node.colour !== 'white' && node.kind === 'step' ? ' strong' : ''}` });
    const lines = nodeLines(node);
    lines.forEach((line, i) => {
      const span = svg('tspan', { x: cx, dy: `${i === 0 ? (-(lines.length - 1) / 2) * LINE_HEIGHT : LINE_HEIGHT}em` });
      span.textContent = line;
      text.append(span);
    });
    root.append(text);
  }
  return root;
}

/** Labels are sized for Geist; where another font draws wider, the label shrinks to stay inside its shape. */
function shrinkLabels(): void {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return;
  ctx.font = `600 14px ${getComputedStyle(document.body).fontFamily}`;
  for (const text of document.querySelectorAll<SVGTextElement>('.vf-diagram text[data-room]')) {
    const widest = Math.max(...[...text.querySelectorAll('tspan')].map((t) => ctx.measureText(t.textContent ?? '').width));
    const room = Number(text.dataset.room);
    if (widest > room) text.style.fontSize = `${Math.floor((14 * room * 10) / widest) / 10}px`;
  }
}

function image(src: string, alt = ''): HTMLImageElement {
  const img = el('img');
  img.src = src;
  img.alt = alt;
  img.decoding = 'async';
  return img;
}

function media(card: Card, files: Files, className = 'vf-media'): HTMLElement {
  const box = el('span', className);
  const id = card.kind === 'image' ? card.file.id : card.kind === 'link' ? card.preview?.id : undefined;
  const src = id ? files[id] : undefined;
  if (src) box.append(image(src, card.kind === 'image' ? card.title : ''));
  return box;
}

function badge(n: number, large = false): HTMLElement {
  return el('span', large ? 'vf-badge lg' : 'vf-badge', String(n));
}

function say(card: Card): HTMLElement | undefined {
  return card.say ? el('span', 'vf-say', card.say) : undefined;
}

function fileOpen(card: Card, files: Files): HTMLElement | undefined {
  if (card.kind !== 'file') return undefined;
  const href = files[card.file.id];
  if (!href) return undefined;
  const a = el('a', 'vf-open', 'Open');
  a.href = href;
  a.download = card.file.name;
  return a;
}

function fileIcon(card: Card): HTMLElement {
  const ext = card.kind === 'file' ? (card.file.name.split('.').pop() ?? '').slice(0, 4).toUpperCase() : '';
  const box = el('span', `vf-file-icon${ext === 'PDF' ? ' is-pdf' : ''}`, ext);
  box.setAttribute('aria-hidden', 'true');
  return box;
}

function checks(card: Card): HTMLElement {
  const list = el('ul', 'vf-checks');
  if (card.kind !== 'checklist') return list;
  for (const item of card.items) {
    const li = el('li', item.done ? 'done' : '');
    const box = el('span', 'vf-box');
    if (item.done) box.append(icon(11, TICK, false, 'var(--bk-card)'));
    li.append(box, document.createTextNode(item.text));
    list.append(li);
  }
  return list;
}

const doneCount = (card: Card): string => (card.kind === 'checklist' ? `${card.items.filter((i) => i.done).length}/${card.items.length}` : '');

/** The line under a card's title in the list. */
function subtitle(card: Card): string {
  switch (card.kind) {
    case 'note': return card.text.split('\n')[0] ?? '';
    case 'link': return card.site || hostOf(card.url);
    case 'diagram': return `${card.diagram.nodes.length} boxes`;
    case 'image': return hostOf(card.pageUrl);
    case 'file': return [formatBytes(card.file.size), card.pages ? `${card.pages} pages` : ''].filter(Boolean).join(' · ');
    case 'checklist': return `${card.items.filter((i) => i.done).length} of ${card.items.length} done`;
  }
}

function canvasCard(card: Card, n: number, files: Files): HTMLElement {
  const colour = card.colour === 'white' ? '' : ` c-${card.colour}`;
  const node = card.kind === 'link' && safeHref(card.url) ? newTab(el('a', `vf-card${colour}`), card.url) : el('article', `vf-card${colour}`);
  node.setAttribute('aria-label', `${KIND[card.kind]}: ${cardLabel(card)}`);
  switch (card.kind) {
    case 'note': {
      const pad = el('div', 'vf-pad');
      const head = el('div', 'vf-row');
      head.append(badge(n));
      if (card.title) head.append(el('span', 'vf-card-title', card.title));
      pad.append(head, el('span', 'vf-note-text', card.text));
      const s = say(card);
      if (s) pad.append(s);
      node.append(pad);
      break;
    }
    case 'link': {
      const m = media(card, files);
      m.style.height = '48%';
      m.append(badge(n));
      const text = el('div', 'vf-text');
      text.append(el('span', 'vf-site', `${card.site || hostOf(card.url)} · opens in a new tab`), el('span', 'vf-card-title', card.title));
      const s = say(card);
      if (s) text.append(s);
      node.append(m, text);
      break;
    }
    case 'image': {
      const m = media(card, files, 'vf-media vf-image-media');
      if (!m.firstChild && safeHref(card.pageUrl)) m.append(newTab(el('a', 'vf-missing', hostOf(card.pageUrl)), card.pageUrl!));
      m.append(badge(n));
      node.append(m, el('div', 'vf-image-title', card.title));
      break;
    }
    case 'file': {
      const box = el('div', 'vf-file');
      const text = el('div', 'vf-file-text');
      const num = el('span', 'vf-row');
      num.append(badge(n));
      text.append(num, el('span', 'vf-card-title', card.title || card.file.name));
      const open = fileOpen(card, files);
      if (open) text.append(open);
      const s = say(card);
      if (s) text.append(s);
      box.append(fileIcon(card), text);
      node.append(box);
      break;
    }
    case 'checklist': {
      const pad = el('div', 'vf-pad');
      const head = el('div', 'vf-row');
      head.append(badge(n), el('span', 'vf-card-title vf-grow', card.title), el('span', 'vf-count', doneCount(card)));
      pad.append(head, checks(card));
      node.append(pad);
      break;
    }
    case 'diagram': {
      const head = el('header', 'vf-diagram-head');
      head.append(badge(n), el('span', 'vf-card-title', card.title));
      const body = el('div', 'vf-diagram-body');
      body.append(diagramSvg(card.diagram, card.title));
      node.append(head, body);
      break;
    }
  }
  return node;
}

function thumb(card: Card, files: Files): HTMLElement {
  const box = el('span', 'vf-thumb');
  box.setAttribute('aria-hidden', 'true');
  const id = card.kind === 'image' ? card.file.id : card.kind === 'link' ? card.preview?.id : undefined;
  if (id && files[id]) box.append(image(files[id]!));
  else if (card.kind === 'link' || card.kind === 'image') box.classList.add('media');
  else if (card.kind === 'note' && card.colour !== 'white') box.classList.add(`c-${card.colour}`);
  else if (card.kind === 'file' && /\.pdf$/i.test(card.file.name)) box.classList.add('is-pdf');
  return box;
}

function sectionHead(entry: Entry, tag: 'h2' | 'h3'): HTMLElement {
  const h = el(tag, 'vf-section', `${entry.sectionIndex + 1} · ${entry.section.title}`);
  h.append(el('span', 'rule'), el('span', 'min', `${entry.section.minutes} min`));
  return h;
}

function walkCard(card: Card, files: Files): HTMLElement {
  const colour = card.colour === 'white' ? '' : ` c-${card.colour}`;
  const box = el('article', `vf-big${colour}`);
  const head = el('header', 'vf-big-head');
  head.append(el('span', 't', cardLabel(card)), el('span', 'k', KIND[card.kind]));
  const body = el('div', 'vf-big-body');
  switch (card.kind) {
    case 'note':
      body.classList.add('pad');
      body.append(el('span', 'vf-note-text', card.text));
      break;
    case 'link': {
      body.append(media(card, files));
      const text = el('div', 'vf-big-link');
      text.append(el('span', 'vf-site', card.site || hostOf(card.url)));
      if (card.text) text.append(el('span', 'excerpt', card.text.slice(0, 400)));
      body.append(text);
      break;
    }
    case 'image':
      body.append(media(card, files, 'vf-media vf-image-media'));
      break;
    case 'file': {
      body.classList.add('pad');
      const row = el('div', 'vf-file');
      const text = el('div', 'vf-file-text');
      text.append(el('span', 'vf-card-title', card.file.name), el('span', 'vf-site', subtitle(card)));
      const open = fileOpen(card, files);
      if (open) text.append(open);
      row.append(fileIcon(card), text);
      body.append(row);
      break;
    }
    case 'checklist':
      body.classList.add('pad');
      body.append(checks(card));
      break;
    case 'diagram': {
      const d = el('div', 'vf-diagram-body');
      d.append(diagramSvg(card.diagram, card.title));
      body.append(d);
      break;
    }
  }
  box.append(head, body);
  return box;
}

function narrowCard(entry: Entry, files: Files): HTMLElement {
  const { card, n } = entry;
  const colour = card.colour === 'white' ? '' : ` c-${card.colour}`;
  const row = (top = false, ...children: (Node | undefined)[]) => {
    const r = el('span', `vf-n-row${top ? ' top' : ''}`);
    r.append(badge(n, true), ...children.filter((c): c is Node => !!c));
    return r;
  };
  const column = (...children: (Node | undefined)[]) => {
    const c = el('span', 'vf-title');
    c.append(...children.filter((x): x is Node => !!x));
    return c;
  };
  switch (card.kind) {
    case 'note': {
      const a = el('article', `vf-n-card${colour}`);
      const pad = el('div', 'vf-n-pad');
      const head = el('span', 'vf-row');
      head.append(badge(n, true), el('span', 'vf-item-title', card.title));
      pad.append(head, el('span', 'vf-note-text', card.text));
      const s = say(card);
      if (s) pad.append(s);
      a.append(pad);
      return a;
    }
    case 'link': {
      const href = safeHref(card.url);
      const a = href ? newTab(el('a', `vf-n-card${colour}`), href) : el('article', `vf-n-card${colour}`);
      a.append(media(card, files), row(false, column(el('span', 't', card.title), el('span', 'vf-site', `${card.site || hostOf(card.url)} · opens in a new tab`), say(card))));
      return a;
    }
    case 'diagram': {
      const a = el('article', `vf-n-card${colour}`);
      const t = el('span', 't vf-grow', card.title);
      a.append(diagramSvg(card.diagram, card.title), row(true, t, el('span', 'vf-site', 'Pinch to zoom')));
      return a;
    }
    case 'image': {
      const a = el('article', `vf-n-card${colour}`);
      a.append(media(card, files, 'vf-media image'), row(false, el('span', 't', card.title)));
      return a;
    }
    case 'file': {
      const a = el('article', `vf-n-card${colour}`);
      a.append(row(false, fileIcon(card), column(el('span', 't', card.title || card.file.name), el('span', 'vf-site', subtitle(card)), fileOpen(card, files), say(card))));
      return a;
    }
    case 'checklist': {
      const a = el('article', `vf-n-card${colour}`);
      const pad = el('div', 'vf-n-pad');
      const head = el('span', 'vf-row');
      head.append(badge(n, true), el('span', 'vf-item-title vf-grow', card.title), el('span', 'vf-count', doneCount(card)));
      pad.append(head, checks(card));
      a.append(pad);
      return a;
    }
  }
}

function printList(board: Board, entries: Entry[], files: Files, shared: string): HTMLElement {
  const root = el('div', 'vf-print');
  root.append(el('h1', '', board.name), el('span', 'meta', `Briefkord · ${shared} · ${entries.length} cards`));
  let section: Section | undefined;
  for (const entry of entries) {
    const { card, n } = entry;
    if (entry.section !== section) {
      section = entry.section;
      root.append(el('h2', '', `${entry.sectionIndex + 1} · ${section.title}`));
    }
    const sub = card.kind === 'note' ? card.text : subtitle(card);
    const line = el('p', '', `${n} ${card.title}${card.kind === 'note' && sub ? `: ${sub}` : ''}`);
    if (card.kind !== 'note' && sub) line.append(' ', el('span', 'site', sub));
    root.append(line);
    if (card.kind === 'diagram') root.append(diagramSvg(card.diagram, card.title));
    if (card.kind === 'image' && files[card.file.id]) root.append(image(files[card.file.id]!, card.title));
    if (card.say) root.append(el('p', 'say', card.say));
  }
  return root;
}

function bounds(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

/** Cards in list order, numbered, with their section. */
function listOrder(board: Board): Entry[] {
  const out: Entry[] = [];
  board.sections.forEach((section, sectionIndex) => {
    for (const id of section.cards) {
      const card = board.cards[id];
      if (card) out.push({ card, n: out.length + 1, section, sectionIndex });
    }
  });
  return out;
}

function canvasLayer(board: Board, entries: Entry[], files: Files): HTMLElement {
  const layer = el('div', 'vf-layer');
  const numbers = new Map(entries.map((e) => [e.card.id, e.n]));
  for (const group of board.groups) {
    const rect = bounds(group.cards.flatMap((id) => (board.cards[id] ? [board.cards[id].rect] : [])));
    const box = el('section', 'vf-group');
    box.setAttribute('aria-label', `Group: ${group.title}`);
    Object.assign(box.style, { left: `${rect.x - 18}px`, top: `${rect.y - 20}px`, width: `${rect.w + 36}px`, height: `${rect.h + 38}px` });
    box.append(el('span', 'vf-group-label', group.title));
    layer.append(box);
  }
  const lines = svg('svg', { class: 'vf-arrows', width: 1, height: 1 });
  const defs = svg('defs');
  lines.append(defs);
  const head = arrowHead(defs, 'head');
  for (const arrow of board.arrows) {
    const a = board.cards[arrow.from]?.rect, b = board.cards[arrow.to]?.rect;
    if (!a || !b) continue;
    const [x1, y1] = edgePoint(a, b.x + b.w / 2, b.y + b.h / 2, 4);
    const [x2, y2] = edgePoint(b, a.x + a.w / 2, a.y + a.h / 2, 6);
    const path = svg('path', { d: `M${x1} ${y1}L${x2} ${y2}`, class: arrow.dashed ? 'dashed' : '', 'marker-end': head });
    if (arrow.both) path.setAttribute('marker-start', head);
    lines.append(path);
    if (arrow.label) {
      const t = svg('text', { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 6 });
      t.textContent = arrow.label;
      lines.append(t);
    }
  }
  layer.append(lines);
  for (const card of Object.values(board.cards).sort((p, q) => p.z - q.z)) {
    const node = canvasCard(card, numbers.get(card.id) ?? 0, files);
    Object.assign(node.style, { left: `${card.rect.x}px`, top: `${card.rect.y}px`, width: `${card.rect.w}px`, height: `${card.rect.h}px` });
    layer.append(node);
  }
  return layer;
}

function render(board: Board, files: Files, meta: Meta | undefined): void {
  document.title = board.name;
  const entries = listOrder(board);
  const at = meta?.at ?? board.updatedAt;
  const count = `${entries.length} ${entries.length === 1 ? 'card' : 'cards'}`;

  // Wide page: header, then the canvas or the list.
  const wide = el('div', 'vf-wide');
  const head = el('header', 'vf-head');
  const title = el('div', 'vf-title');
  title.append(el('h1', '', board.name), el('span', 'vf-sub', `Shared from Briefkord · ${formatDay(at, true)} · ${count}`));
  const only = el('span', 'vf-only');
  only.append(icon(13, EYE), 'View only');
  const tabs = el('div', 'vf-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'View');
  const tab = (label: string) => {
    const b = el('button', '', label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    tabs.append(b);
    return b;
  };
  const canvasTab = tab('Canvas'), listTab = tab('List');
  const walkButton = (className: string) => {
    const b = el('button', className);
    b.type = 'button';
    b.append(icon(14, PLAY, true), 'Walk through');
    b.addEventListener('click', () => openWalk(0));
    return b;
  };
  head.append(logo(), title, only, el('span', 'vf-grow'), tabs, walkButton('vf-walk-btn'));

  const stage = el('main', 'vf-stage');
  stage.setAttribute('aria-label', 'Canvas');
  const layer = canvasLayer(board, entries, files);
  const ask = el('div', 'vf-ask');
  const get = newTab(el('a', '', 'Get Briefkord'), REPO);
  ask.append(icon(16, PEN, false, 'var(--bk-accent)'), el('span', '', 'Want to change something? Ask for the edit file and import it into Briefkord.'), get);
  const zoomBar = el('div', 'vf-zoom');
  const zoomOut = el('button', '', '−'), zoomIn = el('button', '', '+'), zoomLabel = el('span');
  zoomOut.type = zoomIn.type = 'button';
  zoomOut.setAttribute('aria-label', 'Zoom out');
  zoomIn.setAttribute('aria-label', 'Zoom in');
  zoomBar.append(zoomOut, zoomLabel, zoomIn);
  stage.append(layer, ask, zoomBar);

  const list = el('main', 'vf-list');
  list.setAttribute('aria-label', 'List');
  const col = el('div', 'vf-list-col');
  let section: Section | undefined;
  entries.forEach((entry, i) => {
    if (entry.section !== section) {
      section = entry.section;
      col.append(sectionHead(entry, 'h3'));
    }
    const item = el('button', 'vf-item');
    item.type = 'button';
    const text = el('span', 'vf-item-text');
    text.append(el('span', 'vf-item-title', entry.card.title || (entry.card.kind === 'file' ? entry.card.file.name : '')));
    const sub = subtitle(entry.card);
    if (sub) text.append(el('span', 'vf-item-sub', sub));
    item.append(badge(entry.n, true), thumb(entry.card, files), text, el('span', 'vf-item-kind', KIND[entry.card.kind]));
    item.addEventListener('click', () => openWalk(i));
    col.append(item);
  });
  list.append(col);
  wide.append(head, stage, list);

  const showView = (view: 'canvas' | 'list') => {
    stage.hidden = view !== 'canvas';
    list.hidden = view !== 'list';
    stage.style.display = view === 'canvas' ? '' : 'none';
    list.style.display = view === 'list' ? '' : 'none';
    canvasTab.setAttribute('aria-selected', String(view === 'canvas'));
    listTab.setAttribute('aria-selected', String(view === 'list'));
    if (view === 'canvas') fit();
  };
  canvasTab.addEventListener('click', () => showView('canvas'));
  listTab.addEventListener('click', () => showView('list'));

  // Narrow page: a stacked list in card order.
  const narrow = el('div', 'vf-narrow');
  const nHead = el('header', 'vf-n-head');
  const nTop = el('div', 'vf-row');
  const nTitle = el('div', 'vf-title vf-grow');
  nTitle.append(el('h1', '', board.name), el('span', 'vf-sub', `Shared ${formatDay(at)} · ${count} · View only`));
  nTop.append(logo(), nTitle);
  nHead.append(nTop, walkButton('vf-walk-btn vf-n-walk'));
  const nMain = el('main', 'vf-n-main');
  section = undefined;
  for (const entry of entries) {
    if (entry.section !== section) {
      section = entry.section;
      nMain.append(sectionHead(entry, 'h2'));
    }
    nMain.append(narrowCard(entry, files));
  }
  narrow.append(nHead, nMain, el('footer', 'vf-n-foot', 'On a small screen the board shows as a list in card order. Open it on a computer for the canvas.'));

  // Walk through: one card at a time, no notes, no timer.
  const walk = el('div', 'vf-walk');
  walk.hidden = true;
  walk.setAttribute('role', 'dialog');
  walk.setAttribute('aria-label', 'Walk through');
  const wHead = el('header', 'vf-walk-head');
  const wSection = el('span', 'vf-walk-section');
  const progress = el('span', 'vf-progress');
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuemin', '1');
  progress.setAttribute('aria-valuemax', String(entries.length));
  const segments = entries.map(() => progress.appendChild(el('span')));
  const back = el('button', 'vf-back', 'Back to the board');
  back.type = 'button';
  back.append(el('kbd', '', 'Esc'));
  back.addEventListener('click', () => closeWalk());
  wHead.append(el('span', 'vf-walk-name', board.name), wSection, progress, el('span', 'vf-walk-only', 'View only'), back);
  const wMain = el('main', 'vf-walk-main');
  const nav = el('div', 'vf-walk-nav');
  const prev = el('button', 'prev');
  prev.type = 'button';
  prev.setAttribute('aria-label', 'Previous card');
  prev.append(icon(18, LEFT));
  const of = el('span', 'of');
  const next = el('button', 'next');
  next.type = 'button';
  const sep = el('span', 'sep');
  const page = el('a', 'page', 'Open the page');
  page.target = '_blank';
  page.rel = 'noopener noreferrer';
  nav.append(prev, of, next, sep, page);
  walk.append(wHead, wMain);
  let walkIndex = 0;
  let big: HTMLElement | undefined;

  const scaleBig = () => {
    if (!big) return;
    const s = Math.min(1.18, (wMain.clientWidth - 32) / 640, (wMain.clientHeight - 120) / 400);
    big.style.transform = `scale(${Math.max(0.3, s)})`;
  };
  const showCard = (i: number) => {
    walkIndex = Math.max(0, Math.min(entries.length - 1, i));
    const entry = entries[walkIndex];
    if (!entry) return;
    wSection.textContent = entry.section.title;
    progress.setAttribute('aria-valuenow', String(walkIndex + 1));
    progress.setAttribute('aria-label', `Card ${walkIndex + 1} of ${entries.length}`);
    segments.forEach((s, k) => (s.className = k < walkIndex ? 'past' : k === walkIndex ? 'now' : ''));
    big = walkCard(entry.card, files);
    wMain.replaceChildren(big, nav);
    wMain.setAttribute('aria-label', `Card ${walkIndex + 1} of ${entries.length}`);
    prev.disabled = walkIndex === 0;
    of.textContent = `${walkIndex + 1} of ${entries.length}`;
    const following = entries[walkIndex + 1];
    next.replaceChildren(el('span', '', following ? `Next: ${following.card.title}` : 'Back to the board'), icon(16, RIGHT));
    const href = entry.card.kind === 'link' ? safeHref(entry.card.url) : entry.card.kind === 'image' ? safeHref(entry.card.pageUrl) : undefined;
    page.hidden = sep.hidden = !href;
    page.style.display = sep.style.display = href ? '' : 'none';
    if (href) page.href = href;
    scaleBig();
  };
  prev.addEventListener('click', () => showCard(walkIndex - 1));
  next.addEventListener('click', () => (walkIndex < entries.length - 1 ? showCard(walkIndex + 1) : closeWalk()));
  function openWalk(i: number): void {
    if (entries.length === 0) return;
    walk.hidden = false;
    showCard(i);
    back.focus();
  }
  function closeWalk(): void {
    walk.hidden = true;
  }
  addEventListener('keydown', (event) => {
    if (walk.hidden) return;
    if (event.key === 'Escape') closeWalk();
    else if (event.key === 'ArrowRight' || event.key === 'PageDown' || (event.key === ' ' && event.target === document.body)) showCard(walkIndex + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'PageUp') showCard(walkIndex - 1);
    else return;
    event.preventDefault();
  });

  document.body.append(wide, narrow, walk, printList(board, entries, files, formatDay(at, true)));
  void document.fonts.ready.then(shrinkLabels);

  // Canvas camera: drag to pan, wheel to scroll, Ctrl + wheel or the buttons to zoom.
  let cam = { x: 0, y: 0, zoom: 1 };
  const apply = () => {
    layer.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`;
    zoomLabel.textContent = `${Math.round(cam.zoom * 100)}%`;
  };
  const all = bounds(Object.values(board.cards).map((c) => c.rect));
  function fit(): void {
    const w = stage.clientWidth, h = stage.clientHeight - 64;
    if (w <= 0 || h <= 0) return;
    const zoom = Math.min(1, Math.max(0.1, Math.min((w - 80) / all.w, (h - 60) / all.h)));
    cam = { x: (w - all.w * zoom) / 2 - all.x * zoom, y: (h - all.h * zoom) / 2 - all.y * zoom + 10, zoom };
    apply();
  }
  const zoomAt = (factor: number, px = stage.clientWidth / 2, py = stage.clientHeight / 2) => {
    const zoom = Math.min(4, Math.max(0.1, cam.zoom * factor));
    cam = { x: px - ((px - cam.x) / cam.zoom) * zoom, y: py - ((py - cam.y) / cam.zoom) * zoom, zoom };
    apply();
  };
  zoomOut.addEventListener('click', () => zoomAt(1 / 1.2));
  zoomIn.addEventListener('click', () => zoomAt(1.2));
  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const box = stage.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX - box.left, event.clientY - box.top);
    } else {
      cam = { ...cam, x: cam.x - event.deltaX, y: cam.y - event.deltaY };
      apply();
    }
  }, { passive: false });

  let drag: { x: number; y: number; moved: boolean } | undefined;
  let suppressClick = false;
  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target as Element).closest('.vf-ask, .vf-zoom')) return;
    drag = { x: event.clientX, y: event.clientY, moved: false };
  });
  addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag = { x: event.clientX, y: event.clientY, moved: true };
    stage.classList.add('is-dragging');
    cam = { ...cam, x: cam.x + dx, y: cam.y + dy };
    apply();
  });
  const stop = () => {
    suppressClick = !!drag?.moved;
    drag = undefined;
    stage.classList.remove('is-dragging');
  };
  addEventListener('pointerup', stop);
  addEventListener('pointercancel', stop);
  // A drag that starts on a link card must not open the link.
  stage.addEventListener('click', (event) => {
    if (suppressClick) event.preventDefault();
    suppressClick = false;
  }, true);
  stage.addEventListener('dragstart', (event) => event.preventDefault());

  addEventListener('resize', () => {
    scaleBig();
    if (stage.style.display !== 'none') fit();
  });
  showView('canvas');
  document.documentElement.dataset.cards = String(Object.keys(board.cards).length);
}

export default defineUnlistedScript(() => {
  const board = readJson<Board>('board');
  if (!board || typeof board.cards !== 'object' || !Array.isArray(board.sections)) {
    document.body.append(el('p', 'vf-missing', 'This view file has no board in it.'));
    return;
  }
  render(board, readJson<Files>('files') ?? {}, readJson<Meta>('meta'));
});
