import { describe, expect, it } from 'vitest';
import type { TemplateId } from '../../lib/types';
import { litTemplate } from './SwapTemplate';

const cur = 'cur' as TemplateId;
const a = 'a' as TemplateId;
const b = 'b' as TemplateId;

describe('litTemplate', () => {
  it('shows a hovered tile without picking it', () => expect(litTemplate(undefined, a, cur)).toBe(a));
  it('falls back to the pick once hover leaves', () => expect(litTemplate(a, undefined, cur)).toBe(a));
  it('crossing another tile does not change the pick', () => expect(litTemplate(a, b, cur)).toBe(b));
  it('hovering Current keeps the pick lit', () => expect(litTemplate(a, cur, cur)).toBe(a));
  it('nothing picked or hovered lights nothing', () => expect(litTemplate(undefined, undefined, cur)).toBeUndefined());
});
