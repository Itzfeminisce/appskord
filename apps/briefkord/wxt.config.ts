import { defineAppConfig } from '@appskord/config';
import { OPTIONAL_HOSTS } from './lib/hosts';

// Briefkord's public key fixes the extension id (ghbafbelhbkgelfckkdkaclkjmidepea) for Penv Cloud and the Web Store.
// It is public; the private key stays with the owner and is uploaded once, with the first Web Store zip.
const BRIEFKORD_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAr0aHCeKtLsAlLrtCkCK+MQHI4T8N7ehtvxvNfRhU1YFM2GSb9+CDvuteLoZGxvil6x28o5cfsZ3B/WLZC8/v774vqhkweWOk4mdT+HpxAOBnxjFBjlqqGD8rN9en77izjDg8QxOf/+7tQ+Br9nNeL8+0ExIohvnCQQrzYTJUSMn39LmM8ahPdCM8isypyHIabRwo0UtzmfsK/aNUZ/eWnmxfwUld6DnNgBdwgAwZiVDxHmvHyp48uXO3GmqnibUJ39GtYWmLEgyfktDQm8g5H6gcwqmAj7c3cjxVqC4u/d2Pl6WgaRiWbRIXffu8b6Cmhl9l+YRtkDLvjhia74xomwIDAQAB';

export default defineAppConfig({
  name: 'Briefkord',
  description: 'One board for every meeting',
  publicKey: BRIEFKORD_KEY,
  // The machine check page (T0) ships in the test build only.
  devOnlyEntrypoints: ['check', 'check-view'],
  icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
  // activeTab + scripting read the page being saved; contextMenus adds "Save to Briefkord".
  permissions: ['sidePanel', 'storage', 'unlimitedStorage', 'activeTab', 'scripting', 'contextMenus'],
  // Requested only when the user connects Penv Cloud or picks an AI provider (lib/hosts.ts).
  optionalHostPermissions: OPTIONAL_HOSTS,
});
