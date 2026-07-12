import { envConfigs } from '@/config';

import * as mysqlSchema from './schema.mysql';
import * as postgresSchema from './schema.postgres';
import * as sqliteSchema from './schema.sqlite';

const schema = (
  ['sqlite', 'turso'].includes(envConfigs.database_provider)
    ? sqliteSchema
    : envConfigs.database_provider === 'mysql'
      ? mysqlSchema
      : postgresSchema
) as typeof postgresSchema;

// Keep a single import surface for models while selecting the matching Drizzle
// table definitions at runtime. The provider-specific files intentionally share
// the same exported table names.
export const user = schema.user;
export const session = schema.session;
export const account = schema.account;
export const verification = schema.verification;
export const config = schema.config;
export const taxonomy = schema.taxonomy;
export const post = schema.post;
export const order = schema.order;
export const subscription = schema.subscription;
export const credit = schema.credit;
export const apikey = schema.apikey;
export const role = schema.role;
export const permission = schema.permission;
export const rolePermission = schema.rolePermission;
export const userRole = schema.userRole;
export const aiTask = schema.aiTask;
export const chat = schema.chat;
export const chatMessage = schema.chatMessage;
