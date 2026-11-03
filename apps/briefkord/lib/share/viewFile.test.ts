import { describe, expect, it } from 'vitest';
import { sampleBoard } from '../board/sample';
import { buildViewFile, VIEW_BOARD_ID, VIEW_FILES_ID } from './viewFile';

const jsonBlock = (html: string, id: string): unknown => {
  const match = new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`).exec(html);
  return JSON.parse(match![1]!);
};

describe('buildViewFile', () => {
  const board = { ...sampleBoard(1), name: 'Q3 <review> & "plan"' };
  board.cards['why-now'] = { ...board.cards['why-now']!, title: 'Ends here </script><script>alert(1)</script> <!-- x' };

  it('inlines the renderer, styles, board and files in one page', () => {
    const html = buildViewFile('console.log(1)', 'body{margin:0}', board, { f1: 'data:image/png;base64,AAAA' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<style>body{margin:0}</style>');
    expect(html).toContain('<script>console.log(1)</script>');
    expect(html).toContain('<title>Q3 &lt;review&gt; &amp; &quot;plan&quot;</title>');
    expect(jsonBlock(html, VIEW_BOARD_ID)).toEqual(board);
    expect(jsonBlock(html, VIEW_FILES_ID)).toEqual({ f1: 'data:image/png;base64,AAAA' });
  });

  it('never lets embedded text close a tag', () => {
    const html = buildViewFile('const s = "</script>"; // <!--', 'a::after{content:"</style>"}', board, {});
    expect(html.match(/<\/script/gi)).toHaveLength(3);
    expect(html.match(/<\/style/gi)).toHaveLength(1);
    expect(html).not.toContain('<!--');
  });
});
