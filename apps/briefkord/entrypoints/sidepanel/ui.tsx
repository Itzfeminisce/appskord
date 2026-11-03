/** Small pieces every panel screen shares: header, toast, pop-up menu. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from '@appskord/platform/router';
import { BackIcon, LogoMark, SearchIcon, SettingsIcon } from './icons';
import { openBoardTab, usePanel } from './data';

export function useGo() {
  const router = useRouter();
  return useCallback((to: string, search?: Record<string, string>) => void router.navigate({ to, search: search ?? {} } as never), [router]);
}

export function HomeHeader() {
  const go = useGo();
  const { board } = usePanel();
  return (
    <header className="p-header">
      <span className="p-logo" aria-hidden="true">
        <LogoMark />
      </span>
      <h1>Briefkord</h1>
      <button type="button" className="p-icon-btn" aria-label="Search all boards" disabled={!board} onClick={() => board && openBoardTab(board.id, { search: '1' })}>
        <SearchIcon />
      </button>
      <button type="button" className="p-icon-btn" aria-label="Settings" title="Settings" onClick={() => go('/settings')}>
        <SettingsIcon />
      </button>
    </header>
  );
}

export function BackHeader({ title, to = '/', children }: { title: string; to?: string; children?: ReactNode }) {
  const go = useGo();
  return (
    <header className="p-header is-back">
      <button type="button" className="p-icon-btn is-ink" aria-label="Back" onClick={() => go(to)}>
        <BackIcon />
      </button>
      <h1>{title}</h1>
      {children}
    </header>
  );
}

export interface ToastState { text: string; undo?: () => void; ms: number }

/** One toast at a time; showing another replaces it. */
export function useToast() {
  const [toast, setToast] = useState<ToastState>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((next: ToastState) => {
    clearTimeout(timer.current);
    setToast(next);
    timer.current = setTimeout(() => setToast(undefined), next.ms);
  }, []);
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setToast(undefined);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const view = toast ? (
    <div role="status" className="p-toast">
      <span>{toast.text}</span>
      {toast.undo && (
        <button
          type="button"
          onClick={() => {
            toast.undo?.();
            hide();
          }}
        >
          Undo
        </button>
      )}
    </div>
  ) : null;
  return { show, hide, view };
}

/** Closes on Escape or a click outside `ref`. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => !ref.current?.parentElement?.contains(event.target as Node) && close();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

/** An object URL for a stored file, revoked when it changes or the screen goes. */
export function useFileUrl(load: (() => Promise<Blob | undefined>) | undefined, key: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!load || !key) return setUrl(undefined);
    let made: string | undefined;
    let alive = true;
    load()
      .then((blob) => {
        if (!alive || !blob) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch((error: unknown) => console.error('Briefkord: could not load the preview image', error));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [key]);
  return url;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
