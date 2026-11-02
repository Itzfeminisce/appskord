import { defineConfig, type UserConfig } from 'wxt';

export type AppIcons = Record<number, string>;

export interface AppConfigOptions {
  name: string;
  description: string;
  /** The app's fixed public key; it fixes the extension id. The private key never enters the repo. */
  publicKey: string;
  icons: AppIcons;
  permissions: string[];
  /** Asked for at run time only, never at install. */
  optionalHostPermissions?: string[];
  /** Required hosts. Keep narrow; broad patterns fail the shared checks. */
  hostPermissions?: string[];
  /** Toolbar tooltip. Default `Open <name>`. */
  actionTitle?: string;
  /** Show the toolbar icon (the same icons). Default true. */
  actionIcon?: boolean;
  /** Entrypoint names left out of the release zip (developer pages). */
  devOnlyEntrypoints?: string[];
  /** Extra manifest fields (commands, content_security_policy). Cannot replace the fields above. */
  manifest?: Record<string, unknown>;
  /** Extra WXT config (vite, hooks). Its hooks run after the shared ones; `manifest` is not allowed here. */
  wxt?: Omit<UserConfig, 'manifest'>;
}

/** Release = `wxt zip` or `--mode release`. */
export function isRelease(argv: string[] = process.argv): boolean {
  return argv.includes('zip') || argv.includes('release');
}

/** Store build = `APPSKORD_STORE=1`. The Web Store rejects `manifest.key`; it keeps the id from `key.pem` in the first upload. */
export function isStoreBuild(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.APPSKORD_STORE === '1';
}

/** The WXT config of one app. `WXT_EXTENSION_KEY` overrides the key (CI and tests only). */
export function defineAppConfig(options: AppConfigOptions): UserConfig {
  const { name, description, publicKey, icons, permissions, optionalHostPermissions, hostPermissions } = options;
  const release = isRelease();
  const dropped = options.devOnlyEntrypoints ?? [];
  const extra = options.wxt ?? {};
  const extraHooks = (extra.hooks ?? {}) as Record<string, ((...args: never[]) => unknown) | undefined>;

  return defineConfig({
    modules: ['@wxt-dev/module-react'],
    ...extra,
    hooks: {
      ...extraHooks,
      'entrypoints:found': async (wxt, infos) => {
        if (release) {
          for (const entry of dropped) {
            const at = infos.findIndex((info) => info.name === entry);
            if (at >= 0) infos.splice(at, 1);
          }
        }
        await (extraHooks['entrypoints:found'] as ((...a: unknown[]) => unknown) | undefined)?.(wxt, infos);
      },
    },
    manifest: {
      ...options.manifest,
      ...(isStoreBuild() ? {} : { key: process.env.WXT_EXTENSION_KEY || publicKey }),
      name,
      description,
      icons,
      permissions,
      ...(hostPermissions ? { host_permissions: hostPermissions } : {}),
      ...(optionalHostPermissions ? { optional_host_permissions: optionalHostPermissions } : {}),
      action: {
        default_title: options.actionTitle ?? `Open ${name}`,
        ...(options.actionIcon === false ? {} : { default_icon: icons }),
      },
    },
  });
}
