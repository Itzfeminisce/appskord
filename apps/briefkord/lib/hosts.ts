/** Optional host permissions: the AI providers and Penv Cloud, each asked for inside the click that needs it. */
import { PROVIDERS } from '@appskord/llm';
import { PENV_BASE_URL } from '@appskord/penv';

const pattern = (url: string): string => `${new URL(url).origin}/*`;

export const PENV_HOSTS = [pattern(PENV_BASE_URL)];
export const AI_HOSTS = Object.values(PROVIDERS).map((p) => pattern(p.baseUrl));

/** Every host Briefkord may ask for; the manifest lists exactly these as optional_host_permissions. */
export const OPTIONAL_HOSTS = [...new Set([...PENV_HOSTS, ...AI_HOSTS])];
