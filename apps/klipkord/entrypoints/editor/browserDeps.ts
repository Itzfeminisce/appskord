import RenderWorker from '@/lib/render/render.worker?worker';
import { send } from '@/lib/messages';
import { videoStore } from '@/lib/videoStore';
import type { EditorDeps } from './deps';
import { loadMedia } from './media';
import { workerPreview } from './preview';
import { joinSession } from './session';

/** The editor's real deps: OPFS, the render worker, audio elements, the side panel. */
export function browserDeps(): EditorDeps {
  // sidePanel.open must run inside the click itself, so the tab id is read up front.
  let tabId: number | undefined;
  browser.tabs.getCurrent().then((tab) => { tabId = tab?.id; }, (error) => console.error('Klipkord: could not read the editor tab', error));

  return {
    loadMedia,
    startPreview(canvas, sources) {
      if (!('transferControlToOffscreen' in canvas)) return null;
      return workerPreview(new RenderWorker(), canvas, sources);
    },
    audio(blob) {
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);
      el.preload = 'auto';
      return {
        out: el,
        dispose() {
          el.pause();
          el.removeAttribute('src');
          URL.revokeObjectURL(url);
        },
      };
    },
    joinSession: (id, onTaken) => joinSession(id, { onTaken }),
    openPanel(screen) {
      if (tabId === undefined) return;
      // A panel for this tab only, so the side panel that records in other tabs keeps its screen.
      void browser.sidePanel.setOptions({ tabId, path: `sidepanel.html#/${screen}`, enabled: true });
      browser.sidePanel.open({ tabId }).catch((error) => console.error('Klipkord: could not open the side panel', error));
    },
    useGroq() {
      send({ type: 'transcript/use-groq' }).catch((error) => console.error('Klipkord: could not switch to Groq', error));
    },
    closeTab: () => window.close(),
    putFile: (id, name, file) => videoStore.put(id, name, file),
  };
}
