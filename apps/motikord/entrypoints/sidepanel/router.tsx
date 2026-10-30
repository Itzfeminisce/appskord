import { createRouter } from '../../lib/router';
import BrandKit from '../../screens/BrandKit';
import ClipType from '../../screens/ClipType';
import Grab from '../../screens/Grab';
import Home from '../../screens/Home';
import Library from '../../screens/Library';
import LibraryEmpty from '../../screens/LibraryEmpty';
import Main from '../../screens/Main';
import Making from '../../screens/Making';
import PasteKey from '../../screens/PasteKey';
import PenvConnect from '../../screens/PenvConnect';
import PenvConnected from '../../screens/PenvConnected';
import Privacy from '../../screens/Privacy';
import Recovered from '../../screens/Recovered';
import Settings from '../../screens/Settings';
import Setup from '../../screens/Setup';
import StatesCreate from '../../screens/StatesCreate';
import StatesSetup from '../../screens/StatesSetup';
import Templates from '../../screens/Templates';
import YourMedia from '../../screens/YourMedia';

/** Side panel screens, one per FRAMES.md frame, named as the frame (rows 1, 2, 4 and 6). */
export const sidepanel = createRouter({
  Main, Setup, PenvConnect, PasteKey, PenvConnected,
  Home, ClipType, Templates, YourMedia, Making, Grab,
  BrandKit, Library, LibraryEmpty, Settings, Privacy, Recovered, StatesSetup, StatesCreate,
});
export type SidepanelScreen = (typeof sidepanel.names)[number];
export const { RouterProvider, useRouter, Outlet } = sidepanel;
