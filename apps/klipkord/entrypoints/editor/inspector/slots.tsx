import type { EditorSlots } from '../Editor';
import type { SlotProps } from '../components/slots';
import { CaptionsPanel } from './Captions';
import { LookPanel } from './Look';

/** T13's part of the editor: the Captions tab. */
export const captionsSlots: Pick<EditorSlots, 'inspector'> = {
  inspector: (p: SlotProps) => ({ panels: { Captions: <CaptionsPanel {...p} /> } }),
};

/** T10's part of the editor: the Look tab. */
export const lookSlots: Pick<EditorSlots, 'inspector'> = {
  inspector: (p: SlotProps) => ({ panels: { Look: <LookPanel {...p} /> } }),
};
