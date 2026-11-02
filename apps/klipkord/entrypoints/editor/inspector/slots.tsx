import type { EditorSlots } from '../Editor';
import type { SlotProps } from '../components/slots';
import { CaptionsPanel } from './Captions';

/** T13's part of the editor: the Captions tab. */
export const captionsSlots: Pick<EditorSlots, 'inspector'> = {
  inspector: (p: SlotProps) => ({ panels: { Captions: <CaptionsPanel {...p} /> } }),
};
