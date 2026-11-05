import type { Board } from '../board/types';

/** File id -> `data:` URI. Images show inline; other files become download links. */
export type ViewFiles = Record<string, string>;

/** Ids of the JSON blocks the renderer (entrypoints/viewer) reads. */
export const VIEW_BOARD_ID = 'board';
export const VIEW_FILES_ID = 'files';
export const VIEW_META_ID = 'meta';

/** When the file was made; the renderer shows "Shared from Briefkord · {date}". */
export interface ViewMeta { at: number }

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

// Stops embedded text from closing its tag early or opening an HTML comment.
const safeJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const safeScript = (js: string): string => js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\x21--');
const safeStyle = (css: string): string => css.replace(/<\/(style)/gi, '<\\/$1');

/** The view file: one HTML page with the renderer, its styles, the board and its files inline. Needs no network. */
export function buildViewFile(rendererJs: string, css: string, board: Board, files: ViewFiles, meta?: ViewMeta): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(board.name)}</title>`,
    `<style>${safeStyle(css)}</style>`,
    '</head>',
    '<body>',
    `<script type="application/json" id="${VIEW_BOARD_ID}">${safeJson(board)}</script>`,
    `<script type="application/json" id="${VIEW_FILES_ID}">${safeJson(files)}</script>`,
    ...(meta ? [`<script type="application/json" id="${VIEW_META_ID}">${safeJson(meta)}</script>`] : []),
    `<script>${safeScript(rendererJs)}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
