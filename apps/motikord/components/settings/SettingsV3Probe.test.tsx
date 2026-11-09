// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { sidepanel } from '../../entrypoints/sidepanel/router';
import { mount } from '../../test/mountRouter';

const probes = vi.hoisted(() => ({ probeMachine: vi.fn(), probeAi: vi.fn(async () => true) }));
vi.mock('../../screens/Setup', async (orig) => ({ ...(await orig<typeof import('../../screens/Setup')>()), ...probes }));

describe('SettingsV3 probe', () => {
  it('checks only Chrome’s built-in AI on open, not the preview or export probes', async () => {
    fakeBrowser.reset();
    await mount(sidepanel, 'SettingsV3');
    expect(probes.probeAi).toHaveBeenCalledTimes(1);
    expect(probes.probeMachine).not.toHaveBeenCalled();
  });
});
