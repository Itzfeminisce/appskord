/// <reference path="./modules.d.ts" />
import { configureTextBuilder, Text } from 'troika-three-text';

// Troika's worker builds code from strings, which MV3 forbids; typeset on the main thread. Must run before any font request.
configureTextBuilder({ useWorker: false });

export { Text };
