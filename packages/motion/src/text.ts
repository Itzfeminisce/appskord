/// <reference path="./modules.d.ts" />
import { configureTextBuilder, Text } from 'troika-three-text';

// Troika's worker builds code from strings, which MV3 forbids; typeset on the main thread. Must run before any font request.
configureTextBuilder({ useWorker: false });

// Fallback-glyph data defaults to a CDN; point it at the extension origin so nothing is fetched remotely (uncovered glyphs just render blank).
configureTextBuilder({ unicodeFontsURL: '/unicode-fonts' });

export { Text };
