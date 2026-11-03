// The view file renderer. It is inlined into a standalone HTML page, so it imports only types.
import type { Board, Card, Diagram, Rect } from '../../lib/board/types';

type Files = Record<string, string>;

const SVG = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
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

const safeHref = (url: string): string | undefined => (/^https?:\/\//i.test(url) ? url : undefined);

function diagramSvg(diagram: Diagram): SVGElement {
  const w = Math.max(1, ...diagram.nodes.map((n) => n.x + n.w)) + 8;
  const h = Math.max(1, ...diagram.nodes.map((n) => n.y + n.h)) + 8;
  const root = svg('svg', { viewBox: `0 0 ${w} ${h}`, class: 'diagram' });
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  for (const edge of diagram.edges) {
    const a = byId.get(edge.from), b = byId.get(edge.to);
    if (!a || !b) continue;
    root.append(svg('line', { x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2, class: 'edge' }));
  }
  for (const node of diagram.nodes) {
    const shape = node.kind === 'choice'
      ? svg('polygon', { points: `${node.x + node.w / 2},${node.y} ${node.x + node.w},${node.y + node.h / 2} ${node.x + node.w / 2},${node.y + node.h} ${node.x},${node.y + node.h / 2}` })
      : svg('rect', { x: node.x, y: node.y, width: node.w, height: node.h, rx: node.kind === 'end' ? node.h / 2 : 6 });
    shape.setAttribute('class', `node ${node.colour}`);
    const label = svg('text', { x: node.x + node.w / 2, y: node.y + node.h / 2 });
    label.textContent = node.label;
    root.append(shape, label);
  }
  return root;
}

function cardBody(card: Card, files: Files): HTMLElement {
  const body = el('div', 'body');
  switch (card.kind) {
    case 'note':
      body.append(el('p', 'text', card.text));
      break;
    case 'link': {
      const preview = card.preview && files[card.preview.id];
      if (preview) {
        const img = el('img', 'preview');
        img.src = preview;
        img.alt = '';
        body.append(img);
      }
      const href = safeHref(card.url);
      const link = el('a', 'site', card.site || card.url);
      if (href) {
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      body.append(link);
      if (card.text) body.append(el('p', 'text', card.text.slice(0, 400)));
      break;
    }
    case 'image': {
      const src = files[card.file.id];
      if (src) {
        const img = el('img', 'image');
        img.src = src;
        img.alt = card.title;
        img.decoding = 'async';
        body.append(img);
      } else body.append(el('p', 'missing', card.file.name));
      break;
    }
    case 'file': {
      const href = files[card.file.id];
      const link = el('a', 'download', card.file.name);
      if (href) {
        link.href = href;
        link.download = card.file.name;
      }
      body.append(link);
      break;
    }
    case 'checklist': {
      const list = el('ul', 'checklist');
      for (const item of card.items) list.append(el('li', item.done ? 'done' : '', item.text));
      body.append(list);
      break;
    }
    case 'diagram':
      body.append(diagramSvg(card.diagram));
      break;
  }
  if (card.say) body.append(el('p', 'say', card.say));
  return body;
}

function bounds(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

function render(board: Board, files: Files): void {
  document.title = board.name;
  const cards = Object.values(board.cards);
  const header = el('header', 'bar');
  header.append(el('h1', '', board.name), el('span', 'count', `${cards.length} cards`));
  const stage = el('main', 'stage');
  const layer = el('div', 'layer');
  stage.append(layer);

  const lines = svg('svg', { class: 'arrows', width: 1, height: 1 });
  lines.append(svg('defs', {}));
  const marker = svg('marker', { id: 'head', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' });
  marker.append(svg('path', { d: 'M0 0 L10 5 L0 10 z' }));
  lines.firstChild!.appendChild(marker);
  for (const arrow of board.arrows) {
    const a = board.cards[arrow.from]?.rect, b = board.cards[arrow.to]?.rect;
    if (!a || !b) continue;
    lines.append(svg('line', { x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2, 'marker-end': 'url(#head)', class: arrow.dashed ? 'dashed' : '' }));
  }
  layer.append(lines);

  for (const group of board.groups) {
    const rect = bounds(group.cards.flatMap((id) => (board.cards[id] ? [board.cards[id].rect] : [])));
    const box = el('div', 'group');
    Object.assign(box.style, { left: `${rect.x - 18}px`, top: `${rect.y - 36}px`, width: `${rect.w + 36}px`, height: `${rect.h + 54}px` });
    box.append(el('span', 'group-title', group.title));
    layer.append(box);
  }

  for (const card of cards) {
    const node = el('article', `card ${card.kind} ${card.colour}`);
    Object.assign(node.style, { left: `${card.rect.x}px`, top: `${card.rect.y}px`, width: `${card.rect.w}px`, height: `${card.rect.h}px`, zIndex: String(card.z) });
    node.append(el('h2', 'title', card.title), cardBody(card, files));
    layer.append(node);
  }
  document.body.append(header, stage);

  let cam = { x: 0, y: 0, zoom: 1 };
  const apply = () => (layer.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`);
  const all = bounds(cards.map((c) => c.rect));
  const fit = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    const zoom = Math.min(1, Math.max(0.1, Math.min((w - 80) / all.w, (h - 80) / all.h)));
    cam = { x: (w - all.w * zoom) / 2 - all.x * zoom, y: (h - all.h * zoom) / 2 - all.y * zoom, zoom };
    apply();
  };
  fit();

  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const box = stage.getBoundingClientRect();
      const px = event.clientX - box.left, py = event.clientY - box.top;
      const zoom = Math.min(4, Math.max(0.1, cam.zoom * Math.exp(-event.deltaY * 0.01)));
      cam = { x: px - ((px - cam.x) / cam.zoom) * zoom, y: py - ((py - cam.y) / cam.zoom) * zoom, zoom };
    } else cam = { ...cam, x: cam.x - event.deltaX, y: cam.y - event.deltaY };
    apply();
  }, { passive: false });

  let drag: { x: number; y: number } | undefined;
  stage.addEventListener('pointerdown', (event) => {
    if ((event.target as Element).closest('a')) return;
    drag = { x: event.clientX, y: event.clientY };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', (event) => {
    if (!drag) return;
    cam = { ...cam, x: cam.x + event.clientX - drag.x, y: cam.y + event.clientY - drag.y };
    drag = { x: event.clientX, y: event.clientY };
    apply();
  });
  const stop = () => (drag = undefined);
  stage.addEventListener('pointerup', stop);
  stage.addEventListener('pointercancel', stop);
  document.documentElement.dataset.cards = String(cards.length);
}

export default defineUnlistedScript(() => {
  const board = readJson<Board>('board');
  if (!board || typeof board.cards !== 'object') {
    document.body.append(el('p', 'missing', 'This view file has no board in it.'));
    return;
  }
  render(board, readJson<Files>('files') ?? {});
});
