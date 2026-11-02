import type { EditorSlots } from '../Editor';
import { CleanUpPanel } from './CleanUpPanel';
import { TranscriptPanel } from './TranscriptPanel';

/** T6's parts of the editor: the transcript column and Clean up over the inspector. */
export const transcriptSlots = { transcript: TranscriptPanel, aside: CleanUpPanel } satisfies EditorSlots;
