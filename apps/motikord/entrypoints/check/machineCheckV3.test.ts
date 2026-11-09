// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { MACHINE, machineView, renderMachineCheck } from './machineCheckV3';

const pass = { preview: 'Pass', editor: 'Pass', blocks: 'Pass', export60: 'Pass', export30: 'Pass' } as const;

describe('MachineCheckV3 copy', () => {
  it('reads like the frame when 3D is lighter', () => {
    const v = machineView({ ...pass, editor: 'Slow' }, { cores: 4, memoryGb: 8 }, 12);
    expect(v.headline).toBe('Ready to make clips');
    expect(v.spec).toBe('4 cores · 8 GB memory');
    expect(v.summary).toBe('4 of 5 at full speed. 3D previews lighter.');
    expect(v.footer).toBe('Checked today in 12 s. Runs again after a Chrome update.');
    expect(v.rows.map((r) => [r.title, r.status])).toEqual([
      ['Smooth preview', 'Ready'], ['3D and effects', 'Lighter'], ['Motion blur', 'Ready'], ['60 fps export', 'Ready'], ['Fast video export', 'Ready'],
    ]);
    expect(v.fps60).toBe(true);
  });

  it('counts only what passed and says whether 60 fps export is ready', () => {
    const v = machineView({ ...pass, export60: 'Slow', export30: 'Fail' }, { cores: 2, memoryGb: null }, 30);
    expect(v.summary).toBe('3 of 5 at full speed.');
    expect(v.spec).toBe('2 cores');
    expect(v.fps60).toBe(false);
    expect(machineView(pass, {}, 5).summary).toBe('5 of 5 at full speed.');
  });

  it('draws every frame string, and Check again and Done work', () => {
    const root = document.createElement('div');
    const on = { onAgain: vi.fn(), onDone: vi.fn() };
    renderMachineCheck(root, machineView({ ...pass, editor: 'Slow' }, { cores: 4, memoryGb: 8 }, 12), on);
    for (const text of [
      'Checking this computer', 'Ready to make clips', '4 cores · 8 GB memory', '4 of 5 at full speed. 3D previews lighter.',
      'Smooth preview', '30 fps or more at light quality', '3D and effects', 'Your computer previews 3D at lower quality. Export is always full quality.', 'Lighter',
      'Motion blur', 'Shown live in preview', '60 fps export', 'Ready at 1080p', 'Fast video export', 'Uses your graphics chip', 'Ready',
      'Export renders every frame at full quality. A slower computer takes longer, never looks worse.',
      'Checked today in 12 s. Runs again after a Chrome update.', 'Check again', 'Done',
    ]) expect(root.textContent, text).toContain(text);
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Check again')!.click();
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Done')!.click();
    expect(on.onAgain).toHaveBeenCalled();
    expect(on.onDone).toHaveBeenCalled();
    expect(MACHINE.title).toBe('Checking this computer');
  });

  it('a ready 3D row does not claim the lower-quality line', () => {
    const root = document.createElement('div');
    renderMachineCheck(root, machineView(pass, { cores: 4, memoryGb: 8 }, 9), { onAgain: () => undefined, onDone: () => undefined });
    expect(root.textContent).not.toContain('previews 3D at lower quality');
  });
});
