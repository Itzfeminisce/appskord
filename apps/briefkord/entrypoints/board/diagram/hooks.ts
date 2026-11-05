import type { BoardShell } from '../shell/extensions';

/** Set by the AI task: DiagramEdit's "Describe a change" opens its dialog for the open diagram, and stays off until then. */
export const diagramHooks: { describeChange?: (shell: BoardShell, cardId: string) => void } = {};
