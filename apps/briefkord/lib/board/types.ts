/** The board model from CONTRACT.md. Change a field only after the contract changes. */

export const BOARD_VERSION = 1;

export type CardKind = 'link' | 'image' | 'note' | 'file' | 'checklist' | 'diagram';
export type CardColour = 'white' | 'yellow' | 'teal' | 'blue' | 'rose';
export const CARD_KINDS: readonly CardKind[] = ['link', 'image', 'note', 'file', 'checklist', 'diagram'];
export const CARD_COLOURS: readonly CardColour[] = ['white', 'yellow', 'teal', 'blue', 'rose'];

/** Canvas units, zoom 1. */
export interface Rect { x: number; y: number; w: number; h: number }

/** Bytes live in OPFS at `boards/<boardId>/<id>`. */
export interface FileRef { id: string; name: string; mime: string; size: number }

export interface CardBase {
  id: string;
  kind: CardKind;
  title: string;
  colour: CardColour;
  rect: Rect;
  z: number;
  /** "What to say about it", shown in meeting mode. '' when empty. */
  say: string;
  createdAt: number;
  updatedAt: number;
  /** Set only on a board made by Import from an edit file. */
  mark?: 'changed' | 'added';
}

export interface LinkCard extends CardBase { kind: 'link'; url: string; site: string; preview?: FileRef; text: string; words: number; savedAt: number }
export interface ImageCard extends CardBase { kind: 'image'; file: FileRef; pageUrl?: string }
export interface FileCard extends CardBase { kind: 'file'; file: FileRef; pages?: number }
export interface NoteCard extends CardBase {
  kind: 'note';
  text: string;
  summary?: { of: string; model: string; provider: string; from: number };
  /** Where a saved selection came from. */
  source?: { url: string; title: string };
}
export interface ChecklistItem { id: string; text: string; done: boolean }
export interface ChecklistCard extends CardBase { kind: 'checklist'; items: ChecklistItem[] }
export interface DiagramCard extends CardBase { kind: 'diagram'; diagram: Diagram }
export type Card = LinkCard | ImageCard | FileCard | NoteCard | ChecklistCard | DiagramCard;

export type DiagramNodeKind = 'step' | 'choice' | 'end' | 'text';
export interface DiagramNode { id: string; kind: DiagramNodeKind; label: string; x: number; y: number; w: number; h: number; colour: CardColour; card?: string }
export interface DiagramEdge { id: string; from: string; to: string; label?: string }
export interface Diagram { nodes: DiagramNode[]; edges: DiagramEdge[] }

/** Between cards. */
export interface Arrow { id: string; from: string; to: string; dashed?: boolean; label?: string; both?: boolean }
/** Its rect is derived from its cards. */
export interface Group { id: string; title: string; cards: string[]; colour?: CardColour }
/** List order. */
export interface Section { id: string; title: string; minutes: number; cards: string[] }

export interface Imported { person: string; at: number; changed: number; added: number }

export interface Board {
  version: 1;
  id: string;
  name: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  cards: Record<string, Card>;
  arrows: Arrow[];
  groups: Group[];
  /** At least one. Their card ids, in order, are the list; a card's number is its 1-based place in that order. */
  sections: Section[];
  imported?: Imported;
}

export interface BoardMeta { id: string; name: string; pinned: boolean; cards: number; updatedAt: number; bytes: number; imported?: Board['imported'] }
