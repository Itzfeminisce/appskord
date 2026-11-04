import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { reportPermission, requestAccess, whenReleased } from '@/lib/setup';

// Chrome shows its prompt for this extension's origin; the side panel waits for the report.
const params = new URLSearchParams(location.search);
const wantCamera = params.get('camera') === '1';
const keep = params.get('keep') === '1';

const released = keep ? whenReleased() : Promise.resolve();

requestAccess(wantCamera)
  .then(async (result) => {
    await reportPermission(result);
    await released;
    window.close();
  })
  .catch((error) => console.error('Klipkord: could not ask for mic access', error));
