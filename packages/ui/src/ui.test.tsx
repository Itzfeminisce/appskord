import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Button, Card, EmptyState, Spinner } from './index';

const css = readFileSync(new URL('./components.css', import.meta.url), 'utf8').replace(/\s+/g, '');
const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

describe('Button', () => {
  it('renders each variant and block size with the app text', () => {
    expect(renderToStaticMarkup(<Button>Go</Button>)).toContain('class="btn btn-primary"');
    expect(
      renderToStaticMarkup(
        <Button variant="ghost" block>
          Skip
        </Button>,
      ),
    ).toContain('class="btn btn-ghost btn-block"');
    expect(renderToStaticMarkup(<Button>Go</Button>)).toContain('type="button"');
  });
  it('is not busy by default, and passes clicks through', () => {
    const onClick = vi.fn();
    const el = Button({ onClick, children: 'Go' });
    expect(el.props.onClick).toBe(onClick);
    expect(el.props['aria-busy']).toBeUndefined();
  });
  it('busy shows a labelled spinner, keeps the label and ignores clicks', () => {
    const onClick = vi.fn();
    const el = Button({ busy: true, busyLabel: 'Saving', onClick, children: 'Save' });
    expect(el.props.onClick).not.toBe(onClick);
    expect(el.props['aria-busy']).toBe('true');
    const html = renderToStaticMarkup(
      <Button busy busyLabel="Saving">
        Save
      </Button>,
    );
    expect(html).toContain('is-busy');
    expect(html).toContain('aria-label="Saving"');
    expect(html).toContain('Save');
  });
  it('disabled sets the attribute', () => {
    expect(renderToStaticMarkup(<Button disabled>Go</Button>)).toContain('disabled');
  });
});

describe('component styles', () => {
  it('hover applies to enabled buttons only', () => {
    expect(css).toContain('.btn-primary:hover:not(:disabled)');
    expect(css).toContain('.btn-secondary:hover:not(:disabled)');
    expect(css).toContain('.btn-ghost:hover:not(:disabled)');
    expect(css).toContain('button:not(:disabled):hover');
  });
  it('busy click prevents default so a submit button never submits', () => {
    const onClick = vi.fn();
    const el = Button({ busy: true, type: 'submit', onClick, children: 'Save' });
    const preventDefault = vi.fn();
    el.props.onClick({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });
  it('busy buttons do not brighten on hover', () => {
    expect(css).toContain('.btn.is-busy:hover{filter:none;}');
  });
  it('press shrinks enabled buttons, but not a busy one', () => {
    expect(css).toContain('button:not(:disabled):active,a[href]:active{transform:scale(0.97);}');
    expect(css).toContain('.btn.is-busy:active{transform:none;}');
  });
  it('disabled dims and blocks; busy shows progress', () => {
    expect(css).toMatch(/\.btn:disabled\{[^}]*opacity:0\.5;cursor:not-allowed/);
    expect(css).toMatch(/\.btn\.is-busy\{[^}]*cursor:progress/);
  });
  it('the primary colour comes from tokens, defaulting to the accent', () => {
    expect(css).toContain('var(--btn-primary,var(--accent))');
    expect(css).toContain('var(--btn-primary-hover,var(--accent-hover))');
    expect(tokens).not.toMatch(/--accent\s*:/);
  });
});

describe('Card, Spinner, EmptyState', () => {
  it('Card merges class names', () => {
    expect(renderToStaticMarkup(<Card className="x">hi</Card>)).toContain('class="card x"');
  });
  it('Spinner takes its label and size from the app', () => {
    const html = renderToStaticMarkup(<Spinner label="Loading meetings" size={12} />);
    expect(html).toContain('aria-label="Loading meetings"');
    expect(html).toContain('width:12px');
  });
  it('EmptyState shows only what it is given', () => {
    const html = renderToStaticMarkup(<EmptyState title="Nothing yet" body="Record one." action={<b>Go</b>} />);
    expect(html).toContain('Nothing yet');
    expect(html).toContain('Record one.');
    expect(renderToStaticMarkup(<EmptyState title="T" />)).not.toContain('empty-body');
  });
});
