import { describe, expect, it } from 'vitest';
import { machineNotes } from './Setup';

describe('machineNotes', () => {
  it('shows no cards and no ready rows before the check finishes', () => {
    expect(machineNotes(null)).toMatchObject({ cards: [], previewReady: false });
  });
  it('is all ready on a good computer', () => {
    const n = machineNotes({ preview: 'Pass', fastExport: 'Pass', builtInAi: true });
    expect(n).toEqual({ previewReady: true, exportReady: true, aiReady: true, cards: [] });
  });
  it('picks the Setup states from the check results', () => {
    expect(machineNotes({ preview: 'Pass', fastExport: 'Pass', builtInAi: false }).cards).toEqual(['no-built-in-ai']);
    expect(machineNotes({ preview: 'Slow', fastExport: 'Pass', builtInAi: true }).cards).toEqual(['slow-computer']);
    expect(machineNotes({ preview: 'Pass', fastExport: 'Fail', builtInAi: true }).cards).toEqual(['no-fast-export']);
    expect(machineNotes({ preview: 'Slow', fastExport: 'Fail', builtInAi: false }).cards).toEqual(['no-built-in-ai', 'slow-computer', 'no-fast-export']);
  });
});
