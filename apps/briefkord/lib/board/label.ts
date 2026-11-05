/** The one-line name a card goes by wherever it is listed: its title, else something from its content. Pure. */
import type { Card, CardKind } from './types';

const KIND_NAME: Record<CardKind, string> = { link: 'Link', image: 'Image', note: 'Note', file: 'File', checklist: 'Checklist', diagram: 'Diagram' };
const MAX = 80;

const firstLine = (text: string | undefined): string => {
  for (const line of (text ?? '').split(/\r?\n/)) {
    const clean = line.replace(/\s+/g, ' ').trim();
    if (clean) return clean.length > MAX ? `${clean.slice(0, MAX - 1).trimEnd()}…` : clean;
  }
  return '';
};

const host = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const fromContent = (card: Card): string => {
  switch (card.kind) {
    case 'note': return firstLine(card.text);
    case 'checklist': return firstLine(card.items.find((i) => i.text.trim())?.text);
    case 'diagram': return firstLine(card.diagram.nodes.find((n) => n.label.trim())?.label);
    case 'image': case 'file': return firstLine(card.file.name);
    case 'link': return firstLine(card.site) || host(card.url) || firstLine(card.url);
  }
};

export const cardLabel = (card: Card): string => firstLine(card.title) || fromContent(card) || KIND_NAME[card.kind];
