// T5: the List view and meeting mode behind the board's Canvas / List switch and "Start meeting".
import { startMeeting } from '../meeting/start';
import { extendBoard } from '../shell/extensions';
import { ListView } from './ListView';

extendBoard({ ListView, startMeeting });
