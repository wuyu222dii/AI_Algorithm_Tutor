import { revalidateTag, unstable_cache } from 'next/cache';

import { db } from '@/core/db';
import { envConfigs } from '@/config';
import { config } from '@/config/db/schema';
import {
  getAllSettingNames,
  publicSettingNames,
} from '@/shared/services/settings';

export type Config = typeof config.$inferSelect;
export type NewConfig = typeof config.$inferInsert;
export type UpdateConfig = Partial<Omit<NewConfig, 'name'>>;

export type Configs = Record<string, string>;

export const CACHE_TAG_CONFIGS = 'configs';

export async function saveConfigs(configs: Record<string, string>) {
  const result = await db().transaction(async (tx: any) => {
    const configEntries = Object.entries(configs);
    const results: any[] = [];

    for (const [name, configValue] of configEntries) {
      const [upsertResult] = await tx
        .insert(config)
        .values({ name, value: configValue })
        .onConflictDoUpdate({
          target: config.name,
          set: { value: configValue },
        })
        .returning();

      results.push(upsertResult);
    }

    return results;
  });

  revalidateTag(CACHE_TAG_CONFIGS, 'max');

  return result;
}

export async function addConfig(newConfig: NewConfig) {
  const [result] = await db().insert(config).values(newConfig).returning();
  revalidateTag(CACHE_TAG_CONFIGS, 'max');

  return result;
}

export const getConfigs = unstable_cache(
  async (): Promise<Configs> => {
    const configs: Record<string, string> = {};

    if (!envConfigs.database_url) {
      return configs;
    }

    const result = await db().select().from(config);
    if (!result) {
      return configs;
    }

    for (const config of result) {
      configs[config.name] = config.value ?? '';
    }

    return configs;
  },
  ['configs'],
  {
    revalidate: 3600,
    tags: [CACHE_TAG_CONFIGS],
  }
);

export async function getAllConfigs(): Promise<Configs> {
  let dbConfigs: Configs = {};

  // only get configs from db in server side
  if (typeof window === 'undefined' && envConfigs.database_url) {
    try {
      dbConfigs = await getConfigs();
    } catch (e) {
      console.log(`get configs from db failed:`, e);
      dbConfigs = {};
    }
  }

  const settingNames = await getAllSettingNames();
  settingNames.forEach((key) => {
    const upperKey = key.toUpperCase();
    // use env configs if available
    if (process.env[upperKey]) {
      dbConfigs[key] = process.env[upperKey] ?? '';
    } else if (process.env[key]) {
      dbConfigs[key] = process.env[key] ?? '';
    }
  });

  const configs = {
    ...envConfigs,
    ...dbConfigs,
  };

  return configs;
}

export async function getPublicConfigs(): Promise<Configs> {
  const allConfigs = await getAllConfigs();

  const publicConfigs: Record<string, string> = {};

  // get public configs
  for (const key in allConfigs) {
    if (publicSettingNames.includes(key)) {
      publicConfigs[key] = String(allConfigs[key]);
    }
  }

  const emailAuthEnabled = allConfigs.email_auth_enabled !== 'false';
  const resendConfigured = Boolean(
    allConfigs.resend_api_key?.trim() && allConfigs.resend_sender_email?.trim()
  );
  const googleAuthReady = Boolean(
    allConfigs.google_auth_enabled === 'true' &&
      allConfigs.google_client_id?.trim() &&
      allConfigs.google_client_secret?.trim()
  );
  const githubAuthReady = Boolean(
    allConfigs.github_auth_enabled === 'true' &&
      allConfigs.github_client_id?.trim() &&
      allConfigs.github_client_secret?.trim()
  );

  // Only expose capability flags and public identifiers. Provider secrets and
  // operational configuration must never be serialized to the browser.
  publicConfigs.email_auth_enabled = emailAuthEnabled ? 'true' : 'false';
  publicConfigs.email_verification_enabled =
    emailAuthEnabled &&
    resendConfigured &&
    allConfigs.email_verification_enabled === 'true'
      ? 'true'
      : 'false';
  publicConfigs.password_reset_enabled =
    emailAuthEnabled && resendConfigured ? 'true' : 'false';
  publicConfigs.google_auth_enabled = googleAuthReady ? 'true' : 'false';
  publicConfigs.google_one_tap_enabled =
    googleAuthReady && allConfigs.google_one_tap_enabled === 'true'
      ? 'true'
      : 'false';
  publicConfigs.google_client_id = googleAuthReady
    ? allConfigs.google_client_id
    : '';
  publicConfigs.github_auth_enabled = githubAuthReady ? 'true' : 'false';

  return publicConfigs;
}
