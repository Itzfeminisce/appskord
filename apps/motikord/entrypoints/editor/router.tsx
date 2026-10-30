import { createRouter } from '../../lib/router';
import AccessPrompt from '../../screens/AccessPrompt';
import BrandKit from '../../screens/BrandKit';
import Checker from '../../screens/Checker';
import Credits from '../../screens/Credits';
import Editor from '../../screens/editor/Editor';
import StatesEditor from '../../screens/editor/StatesEditor';
import EditorPrompt from '../../screens/editor/EditorPrompt';
import Export from '../../screens/Export';
import Exported from '../../screens/Exported';
import Formats from '../../screens/editor/Formats';
import Library from '../../screens/Library';
import MediaSearch from '../../screens/MediaSearch';
import Music from '../../screens/Music';
import Presets from '../../screens/editor/Presets';
import Rendering from '../../screens/Rendering';
import YourMedia from '../../screens/YourMedia';

/** Editor tab screens, one per FRAMES.md frame (rows 3, 4 and 5); Library, BrandKit and YourMedia stand in until their tasks route to the side panel. */
export const editor = createRouter({
  Editor, EditorPrompt, Formats, Presets, Checker,
  MediaSearch, AccessPrompt, Music, Credits,
  Export, Rendering, Exported, StatesEditor,
  Library, BrandKit, YourMedia,
});
export type EditorScreen = (typeof editor.names)[number];
export const { RouterProvider, useRouter, Outlet } = editor;
