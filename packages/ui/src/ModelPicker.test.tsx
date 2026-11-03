// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelPicker, type ModelPickerProps, type PickerGroup } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GROUPS: PickerGroup[] = [
  {
    id: 'local',
    name: 'On this computer',
    status: 'local',
    models: [{ id: 'builtin', name: 'Chrome’s built-in AI' }],
  },
  {
    id: 'groq',
    name: 'Groq',
    status: 'ready',
    mark: 'Gq',
    models: [
      { id: 'openai/gpt-oss-120b', tag: 'Recommended' },
      { id: 'openai/gpt-oss-20b', tag: 'Fastest' },
    ],
  },
  { id: 'openai', name: 'OpenAI', status: 'ready', mark: 'OA', models: [{ id: 'gpt-6-luna', tag: 'Recommended' }] },
  {
    id: 'anthropic',
    name: 'Anthropic',
    status: 'needs-key',
    mark: 'An',
    aliases: ['claude'],
    addKeyLabel: 'Add an Anthropic key',
    models: [],
  },
];

const FOOT = 'Each list comes from the provider, using your key.';
let root: Root | undefined;
let host: HTMLElement;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
});

function mount(over: Partial<ModelPickerProps> = {}) {
  const props: ModelPickerProps = {
    label: 'Notes and Ask',
    groups: GROUPS,
    value: { provider: 'groq', model: 'openai/gpt-oss-120b' },
    foot: FOOT,
    onPick: vi.fn(),
    onAddKey: vi.fn(),
    onRetry: vi.fn(),
    onOpen: vi.fn(),
    ...over,
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<ModelPicker {...props} />));
  return props;
}

const button = () => host.querySelector<HTMLButtonElement>('.mp-button')!;
const listbox = () => host.querySelector('[role="listbox"]');
const input = () => host.querySelector<HTMLInputElement>('input')!;
const options = () => [...host.querySelectorAll<HTMLElement>('[role="option"]')];
const click = (el: Element) => act(() => (el as HTMLElement).click());
const key = (el: Element, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
function type(text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ModelPicker', () => {
  it('shows the model and provider status on the button', () => {
    mount();
    expect(button().getAttribute('aria-haspopup')).toBe('listbox');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(button().textContent).toContain('Gq');
    expect(button().textContent).toContain('openai/gpt-oss-120b');
    expect(button().textContent).toContain('Groq · Ready');
  });

  it('a local model shows the laptop and says nothing is sent', () => {
    mount({ value: { provider: 'local', model: 'builtin' } });
    expect(button().querySelector('.mp-mark svg')).not.toBeNull();
    expect(button().textContent).toContain('Chrome’s built-in AI');
    expect(button().textContent).toContain('On this computer · nothing is sent');
  });

  it('opens and closes, by click, Escape and a click outside', () => {
    const props = mount();
    click(button());
    expect(listbox()?.getAttribute('aria-label')).toBe('Notes and Ask model');
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(button().className).toContain('is-open');
    expect(props.onOpen).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input());
    expect(input().placeholder).toBe('Search models');
    expect(host.querySelector('.mp-foot')?.textContent).toBe(FOOT);
    key(input(), 'Escape');
    expect(listbox()).toBeNull();
    expect(document.activeElement).toBe(button());
    click(button());
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(listbox()).toBeNull();
    click(button());
    click(button());
    expect(listbox()).toBeNull();
  });

  it('lists groups with their status, tags and a check on the current model', () => {
    mount();
    click(button());
    const text = listbox()!.textContent!;
    for (const s of ['On this computer', 'Nothing is sent', 'Groq', 'Ready', 'Recommended', 'Fastest', 'Needs a key'])
      expect(text).toContain(s);
    const selected = options().filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected.map((o) => o.textContent)).toEqual(['openai/gpt-oss-120b' + 'Recommended']);
    expect(selected[0]!.querySelector('.mp-check svg')).not.toBeNull();
    expect(text).toContain('Add an Anthropic key');
  });

  it('search filters by model id and by provider name or alias', () => {
    mount();
    click(button());
    type('oss-20');
    expect(options().map((o) => o.textContent)).toEqual(['openai/gpt-oss-20b' + 'Fastest']);
    type('openai');
    expect(options().map((o) => o.textContent)).toEqual([
      'openai/gpt-oss-120bRecommended',
      'openai/gpt-oss-20bFastest',
      'gpt-6-lunaRecommended',
    ]);
    type('claude');
    expect(options()).toHaveLength(0);
    expect(listbox()!.textContent).toContain('Add an Anthropic key');
    expect(listbox()!.textContent).not.toContain('No model called');
  });

  it('picking a row calls onPick and closes', () => {
    const props = mount();
    click(button());
    click(options().find((o) => o.textContent?.startsWith('gpt-6-luna'))!);
    expect(props.onPick).toHaveBeenCalledWith({ provider: 'openai', model: 'gpt-6-luna' }, false);
    expect(listbox()).toBeNull();
  });

  it('arrows move and Enter picks', () => {
    const props = mount();
    key(button(), 'ArrowDown');
    expect(listbox()).not.toBeNull();
    key(input(), 'ArrowDown');
    key(input(), 'ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[2]!.id);
    key(input(), 'Enter');
    expect(props.onPick).toHaveBeenCalledWith({ provider: 'groq', model: 'openai/gpt-oss-20b' }, false);
    expect(listbox()).toBeNull();
  });

  it('no match offers the typed name with the typed provider', () => {
    const props = mount({ typedProvider: 'openai' });
    click(button());
    type('gpt-6-astra-2026-09-01');
    expect(listbox()!.textContent).toContain('No model called “gpt-6-astra-2026-09-01” in your lists.');
    expect(host.querySelector('.mp-foot')?.textContent).toBe(
      'A typed name is checked once with a short test question before it is used.',
    );
    const typed = options()[0]!;
    expect(typed.textContent).toBe('Use “gpt-6-astra-2026-09-01” with OpenAI');
    click(typed);
    expect(props.onPick).toHaveBeenCalledWith({ provider: 'openai', model: 'gpt-6-astra-2026-09-01' }, true);
  });

  it('the key row calls onAddKey with its provider', () => {
    const props = mount();
    click(button());
    click([...host.querySelectorAll('.mp-key')].find((b) => b.textContent === 'Add an Anthropic key')!);
    expect(props.onAddKey).toHaveBeenCalledWith('anthropic');
  });
});

describe('ModelPicker states', () => {
  const groq = (status: PickerGroup['status']) => GROUPS.map((g) => (g.id === 'groq' ? { ...g, status } : g));

  it('picker-loading', () => {
    mount({ groups: groq('loading') });
    click(button());
    expect(listbox()!.textContent).toContain('Getting the list…');
    expect(host.querySelectorAll('.mp-skeleton span')).toHaveLength(3);
    expect(host.querySelector('.mp-foot')?.textContent).toBe('Getting Groq’s list… You can keep typing.');
  });

  it('picker-list-failed', () => {
    const props = mount({ groups: groq('failed') });
    click(button());
    expect(listbox()!.textContent).toContain(
      'Groq’s full list didn’t load, so the suggested models show instead. You can still type any model name.',
    );
    click([...host.querySelectorAll('.mp-link')].find((b) => b.textContent === 'Try again')!);
    expect(props.onRetry).toHaveBeenCalledWith('groq');
  });

  it('picker-model-gone', () => {
    mount({ gone: { old: 'old-groq-model', app: 'Klipkord' } });
    expect(button().className).toContain('is-gone');
    expect(button().textContent).toContain('Groq · picked for you');
    expect(host.querySelector('.mp-gone')?.textContent).toBe(
      'Groq no longer offers old-groq-model, so Klipkord uses openai/gpt-oss-120b. Open the list to pick another.',
    );
  });

  it('picker-key-refused', () => {
    const props = mount({ groups: groq('key-refused') });
    click(button());
    const text = listbox()!.textContent!;
    expect(text).toContain('Key refused');
    expect(text).toContain('Groq refused the key. Check it in Keys, then open this list again.');
    click([...host.querySelectorAll('.mp-key')].find((b) => b.textContent === 'Check the Groq key')!);
    expect(props.onAddKey).toHaveBeenCalledWith('groq');
  });

  it('picker-no-keys', () => {
    const cloud = ['Groq', 'OpenAI', 'Anthropic', 'OpenRouter'].map((name) => ({
      id: name.toLowerCase(),
      name,
      status: 'needs-key' as const,
      models: [],
    }));
    const local: PickerGroup = {
      ...GROUPS[0]!,
      note: 'Ollama isn’t running. Start it, then open this list again.',
    };
    const onConnectCloud = vi.fn();
    const props = mount({ groups: [local, ...cloud], value: { provider: 'local', model: 'builtin' }, onConnectCloud });
    click(button());
    const text = listbox()!.textContent!;
    expect(text).toContain('Ollama isn’t running. Start it, then open this list again.');
    expect(text).toContain('Add a key to pick models from Groq, OpenAI, Anthropic or OpenRouter.');
    expect(text).not.toContain('Needs a key');
    const links = [...host.querySelectorAll('.mp-link')];
    click(links.find((b) => b.textContent === 'Connect Penv Cloud')!);
    expect(onConnectCloud).toHaveBeenCalledOnce();
    click(links.find((b) => b.textContent === 'Paste a key instead')!);
    expect(props.onAddKey).toHaveBeenCalledWith();
  });
});
