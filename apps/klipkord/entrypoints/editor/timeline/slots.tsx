import type { EditorSlots } from '../Editor';
import type { SlotProps } from '../components/slots';
import { timelineInspector } from './Inspectors';
import { openDialog, subscribeTimeline } from './store';
import { Timeline } from './Timeline';

const TimelineBody = (p: SlotProps) => <Timeline {...p} />;

/** T7's part of the editor: the timeline, its inspector selection and the top bar's dialogs. */
export const timelineSlots: EditorSlots = {
  timeline: TimelineBody,
  inspector: timelineInspector,
  topBar: () => ({
    onName: () => openDialog('settings'),
    onCuts: () => openDialog('cuts'),
    onHistory: () => openDialog('history'),
    onShortcuts: () => openDialog('shortcuts'),
  }),
  subscribe: subscribeTimeline,
};
