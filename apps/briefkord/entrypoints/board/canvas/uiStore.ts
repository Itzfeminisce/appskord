/** Canvas selection and editing state that cards read one value at a time, so a click re-renders only the cards it touches. */
import { useSyncExternalStore } from 'react';

export interface UiState {
  selected: ReadonlySet<string>;
  /** A selected arrow or group, instead of cards. */
  arrow?: string;
  group?: string;
  /** The note or checklist being typed in. */
  editing?: string;
  /** "Connect": the card the next clicked card gets an arrow from. */
  connectFrom?: string;
  /** Each card's number in the list. */
  numbers: Readonly<Record<string, number>>;
}

export interface UiStore {
  get(): UiState;
  set(patch: Partial<UiState>): void;
  /** Selects cards only, clearing an arrow or group selection. */
  select(ids: Iterable<string>): void;
  subscribe(listener: () => void): () => void;
}

const EMPTY: ReadonlySet<string> = new Set();

export function createUiStore(): UiStore {
  let state: UiState = { selected: EMPTY, numbers: {} };
  const listeners = new Set<() => void>();
  const store: UiStore = {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    select(ids) {
      const selected = new Set(ids);
      store.set({ selected: selected.size ? selected : EMPTY, arrow: undefined, group: undefined, editing: state.editing && selected.has(state.editing) ? state.editing : undefined });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return store;
}

export function useUi<T>(store: UiStore, pick: (s: UiState) => T): T {
  return useSyncExternalStore(store.subscribe, () => pick(store.get()));
}
