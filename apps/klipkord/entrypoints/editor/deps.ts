import { createContext, useContext } from 'react';
import type { Project } from '@/lib/project/types';
import type { RenderSource } from '@/lib/render/render.worker';
import type { LoadedMedia } from './media';
import type { PreviewClient } from './preview';
import type { EditorSession } from './session';

/** The sound of one source while previewing; an HTMLAudioElement in the browser. */
export interface AudioOut {
  currentTime: number; playbackRate: number; preservesPitch: boolean; volume: number; muted: boolean; readonly paused: boolean;
  play(): Promise<void>; pause(): void;
}

/** Side panel screens the editor sends people to. */
export type PanelScreen = 'Library' | 'Storage';

/** Everything the editor reaches outside React; tests pass fakes. */
export interface EditorDeps {
  loadMedia(project: Project): Promise<LoadedMedia>;
  /** Null where the canvas cannot be handed to a worker. */
  startPreview(canvas: HTMLCanvasElement, sources: RenderSource[]): PreviewClient | null;
  audio(blob: Blob): { out: AudioOut; dispose(): void } | null;
  joinSession(id: string, onTaken: () => Promise<void>): EditorSession;
  openPanel(screen: PanelScreen): void;
  /** "Use Groq instead" for the transcript still being made. */
  useGroq(): void;
  closeTab(): void;
  /** Opens a recording's editor in its own tab. */
  openEditor(recordingId: string): void;
  /** Duplicate project: copies the recording, its files and the project; resolves with the new recording id. */
  duplicateProject(project: Project): Promise<string>;
  /** media-missing "Find the file": puts the picked file back under the recording's folder. */
  putFile(recordingId: string, name: string, file: Blob): Promise<void>;
}

export const DepsContext = createContext<EditorDeps | null>(null);

export function useDeps(): EditorDeps {
  const deps = useContext(DepsContext);
  if (!deps) throw new Error('Klipkord: the editor needs its deps');
  return deps;
}
