/** Pure parts of Settings: the picker's groups and the storage totals. */
import { PROVIDERS, SUGGESTED, type CloudProviderId, type PickerList } from '@appskord/llm';
import type { PickerGroup, PickerOption, PickerValue } from '@appskord/ui';
import type { Board, Card, FileRef } from '@/lib/board/types';
import { AI_PROVIDERS, keyNameOf } from '@/lib/keys';

export type SettingsPart = 'ai' | 'sharing' | 'storage' | 'privacy';
export const PARTS: { id: SettingsPart; label: string }[] = [
  { id: 'ai', label: 'AI and keys' },
  { id: 'sharing', label: 'Sharing' },
  { id: 'storage', label: 'Storage' },
  { id: 'privacy', label: 'Where your data goes' },
];

/** The part `?show=` names, else "AI and keys". */
export const partFor = (show: unknown): SettingsPart => PARTS.find((p) => p.id === show)?.id ?? 'ai';

// ---- Picker ----

export const PICKER_LABEL = 'AI for Brief me, diagrams, order and summaries';
export const PICKER_FOOT = 'Each list comes from the provider, using your key.';

export const MARK: Record<CloudProviderId, string> = { groq: 'Gq', openai: 'OA', anthropic: 'An', google: 'Gm', xai: 'xA', openrouter: 'OR' };
const ADD_KEY: Record<CloudProviderId, string> = {
  groq: 'Add a Groq key', openai: 'Add an OpenAI key', anthropic: 'Add an Anthropic key',
  google: 'Add a Gemini key', xai: 'Add an xAI key', openrouter: 'Add an OpenRouter key',
};
const ALIASES: Partial<Record<CloudProviderId, string[]>> = { anthropic: ['claude'], google: ['google'], xai: ['grok'] };

/** A provider's list: being fetched, fetched (live, or suggested with the error), or not fetched because the key could not be read. */
export type ListState = { status: 'loading' } | { status: 'done'; list: PickerList } | { status: 'failed' };

/** A list is fetched on open when it never was or the last try failed. */
export const needsList = (state: ListState | undefined): boolean => !state || state.status === 'failed';

function group(p: CloudProviderId, value: PickerValue, keyNames: readonly string[], state: ListState | undefined): PickerGroup {
  const base = { id: p, name: PROVIDERS[p].label, mark: MARK[p], aliases: ALIASES[p], addKeyLabel: ADD_KEY[p] };
  if (!keyNames.includes(keyNameOf(p))) return { ...base, status: 'needs-key', models: [] };
  const list = state?.status === 'done' ? state.list : undefined;
  const suggested = (SUGGESTED[p].chat ?? []).map((id, i): PickerOption => (i === 0 ? { id, tag: 'Recommended' } : { id }));
  // "Sees images" matters only to Motikord's critic; Briefkord sends text.
  const models = (list?.models.length ? list.models : suggested).map(({ id, tag }): PickerOption => (tag && tag !== 'Sees images' ? { id, tag } : { id }));
  if (value.provider === p && value.model && !models.some((m) => m.id === value.model)) models.push({ id: value.model, tag: 'Your choice' });
  if (state?.status === 'loading') return { ...base, status: 'loading', models };
  if (list?.error?.code === 'auth') return { ...base, status: 'key-refused', models };
  return { ...base, status: list?.error || state?.status === 'failed' ? 'failed' : 'ready', models };
}

/** The picker's groups: every cloud provider in the shared order. */
export function pickerGroups(value: PickerValue, keyNames: readonly string[], lists: Partial<Record<CloudProviderId, ListState>>): PickerGroup[] {
  return AI_PROVIDERS.map((p) => group(p, value, keyNames, lists[p]));
}

// ---- Storage ----

/** A file in OPFS at `boards/<boardId>/<fileId>`, with its real size. */
export interface StoredFile { boardId: string; fileId: string; size: number }

export interface BoardSpace { id: string; name: string; cards: number; bytes: number }
export interface BigFile { boardId: string; boardName: string; cardId: string; fileId: string; name: string; size: number }
export interface StorageTotals {
  total: number;
  files: number;
  pageText: number;
  boards: number;
  perBoard: BoardSpace[];
  largest: BigFile[];
}

const utf8 = (text: string): number => new TextEncoder().encode(text).byteLength;

export const cardFiles = (card: Card): FileRef[] => {
  if (card.kind === 'image' || card.kind === 'file') return [card.file];
  if (card.kind === 'link' && card.preview) return [card.preview];
  return [];
};

/** Space per board (its JSON plus its files on disk), split into files, saved page text and the rest; biggest first. */
export function storageTotals(boards: readonly Board[], stored: readonly StoredFile[], largestCount = 5): StorageTotals {
  const sizeOf = new Map(stored.map((f) => [`${f.boardId}/${f.fileId}`, f.size]));
  const filesBy = new Map<string, number>();
  for (const f of stored) filesBy.set(f.boardId, (filesBy.get(f.boardId) ?? 0) + f.size);
  let pageText = 0;
  let json = 0;
  const largest: BigFile[] = [];
  const perBoard = boards.map((board): BoardSpace => {
    const cards = Object.values(board.cards);
    const boardJson = utf8(JSON.stringify(board));
    json += boardJson;
    for (const card of cards) {
      if (card.kind === 'link') pageText += utf8(card.text);
      for (const file of cardFiles(card)) {
        const size = sizeOf.get(`${board.id}/${file.id}`);
        if (size !== undefined) largest.push({ boardId: board.id, boardName: board.name, cardId: card.id, fileId: file.id, name: file.name, size });
      }
    }
    return { id: board.id, name: board.name, cards: cards.length, bytes: boardJson + (filesBy.get(board.id) ?? 0) };
  });
  const files = stored.reduce((sum, f) => sum + f.size, 0);
  return {
    total: files + json,
    files,
    pageText,
    boards: json - pageText,
    perBoard: perBoard.sort((a, b) => b.bytes - a.bytes),
    largest: largest.sort((a, b) => b.size - a.size).slice(0, largestCount),
  };
}

/** The card after its file is removed: an image or file keeps its name with no bytes; a link drops its preview. */
export function withoutFile(card: Card, fileId: string): Card {
  if ((card.kind === 'image' || card.kind === 'file') && card.file.id === fileId) return { ...card, file: { ...card.file, size: 0 } };
  if (card.kind === 'link' && card.preview?.id === fileId) {
    const { preview: _gone, ...rest } = card;
    return rest;
  }
  return card;
}

/** The board after a file's bytes are removed: every card that holds the file loses it. */
export function boardWithoutFile(board: Board, fileId: string, now: number): Board {
  const touched = Object.values(board.cards).filter((c) => withoutFile(c, fileId) !== c);
  if (touched.length === 0) return board;
  const cards = { ...board.cards };
  for (const c of touched) cards[c.id] = { ...withoutFile(c, fileId), updatedAt: now };
  return { ...board, cards, updatedAt: now };
}

/** A bar segment's width in percent of `whole`; a non-empty part shows at least 1%. */
export function share(part: number, whole: number): number {
  if (part <= 0 || whole <= 0) return 0;
  return Math.max(1, Math.min(100, (part / whole) * 100));
}
