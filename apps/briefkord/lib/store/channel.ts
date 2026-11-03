/** Tells the side panel and every open board tab that a board changed, so each reloads it. */

export const CHANNEL_NAME = 'briefkord';

export interface BoardChanged { type: 'board-changed'; id: string }

export function postBoardChanged(id: string): void {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({ type: 'board-changed', id } satisfies BoardChanged);
  channel.close();
}

/** Calls `listener` with the id of each changed board, from other pages; returns the unsubscribe. */
export function onBoardChanged(listener: (id: string) => void): () => void {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data as Partial<BoardChanged> | null;
    if (data?.type === 'board-changed' && typeof data.id === 'string') listener(data.id);
  };
  return () => channel.close();
}
