import { createRouter } from '../../lib/router';
import AddSource from '../../screens/AddSource';
import BrandKit from '../../screens/BrandKit';
import ClipType from '../../screens/ClipType';
import Grab from '../../screens/Grab';
import Home from '../../screens/Home';
import Library from '../../screens/Library';
import LibraryEmpty from '../../screens/LibraryEmpty';
import Main from '../../screens/Main';
import Making from '../../screens/Making';
import MediaSources from '../../screens/MediaSources';
import MakingFailed from '../../screens/MakingFailed';
import PasteKey from '../../screens/PasteKey';
import PenvConnect from '../../screens/PenvConnect';
import PenvConnected from '../../screens/PenvConnected';
import Privacy from '../../screens/Privacy';
import Recovered from '../../screens/Recovered';
import Settings from '../../screens/Settings';
import SettingsModel from '../../screens/SettingsModel';
import Setup from '../../screens/Setup';
import StatesCreate from '../../screens/StatesCreate';
import StatesLibrary from '../../screens/StatesLibrary';
import StatesSetup from '../../screens/StatesSetup';
import StatesSources from '../../screens/StatesSources';
import StatesVoice from '../../screens/StatesVoice';
import Templates from '../../screens/Templates';
import VoicePrompt from '../../screens/VoicePrompt';
import YourMedia from '../../screens/YourMedia';

/** Side panel screens, one per FRAMES.md frame, named as the frame (rows 1, 2, 4 and 6). */
export const sidepanel = createRouter({
  Main, Setup, PenvConnect, PasteKey, PenvConnected,
  Home, VoicePrompt, ClipType, Templates, YourMedia, Making, MakingFailed, Grab,
  BrandKit, Library, LibraryEmpty, Settings, SettingsModel, MediaSources, AddSource, Privacy, Recovered, StatesSetup, StatesCreate, StatesLibrary, StatesVoice, StatesSources,
});
export type SidepanelScreen = (typeof sidepanel.names)[number];
export const { RouterProvider, useRouter, Outlet } = sidepanel;
