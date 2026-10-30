import { createRouter } from '../../lib/router';
import AccessPrompt from '../../screens/AccessPrompt';
import Checker from '../../screens/Checker';
import Credits from '../../screens/Credits';
import Editor from '../../screens/Editor';
import EditorPrompt from '../../screens/EditorPrompt';
import Export from '../../screens/Export';
import Exported from '../../screens/Exported';
import Formats from '../../screens/Formats';
import MediaSearch from '../../screens/MediaSearch';
import Music from '../../screens/Music';
import Presets from '../../screens/Presets';
import Rendering from '../../screens/Rendering';

/** Editor tab screens, one per FRAMES.md frame, named as the frame (rows 3, 4 and 5). */
export const editor = createRouter({
  Editor, EditorPrompt, Formats, Presets, Checker,
  MediaSearch, AccessPrompt, Music, Credits,
  Export, Rendering, Exported,
});
export type EditorScreen = (typeof editor.names)[number];
export const { RouterProvider, useRouter, Outlet } = editor;
