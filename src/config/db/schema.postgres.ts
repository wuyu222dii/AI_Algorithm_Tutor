import { sql } from 'drizzle-orm';
import {
  AnyPgColumn,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { envConfigs } from '@/config';

const schemaName = (envConfigs.db_schema || 'algocoach').trim();
// Drizzle forbids pgSchema('public'); for public schema use pgTable().
// For non-public schema (e.g. 'web'), use pgSchema(name).table() to generate "schema"."table".
const customSchema =
  schemaName && schemaName !== 'public' ? pgSchema(schemaName) : null;
const table: typeof pgTable = customSchema
  ? (customSchema.table.bind(customSchema) as unknown as typeof pgTable)
  : pgTable;

export const user = table(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    // Track first-touch acquisition channel (e.g. google, twitter, newsletter)
    utmSource: text('utm_source').notNull().default(''),
    ip: text('ip').notNull().default(''),
    locale: text('locale').notNull().default(''),
  },
  (table) => [
    // Search users by name in admin dashboard
    index('idx_user_name').on(table.name),
    // Order users by registration time for latest users list
    index('idx_user_created_at').on(table.createdAt),
  ]
);

export const session = table(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    // Composite: Query user sessions and filter by expiration
    // Can also be used for: WHERE userId = ? (left-prefix)
    index('idx_session_user_expires').on(table.userId, table.expiresAt),
  ]
);

export const account = table(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // Query all linked accounts for a user
    index('idx_account_user_id').on(table.userId),
    // A provider account must never be linked to more than one local user.
    uniqueIndex('uq_account_provider_account').on(
      table.providerId,
      table.accountId
    ),
  ]
);

export const verification = table(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // Find verification code by identifier (e.g., find code by email)
    index('idx_verification_identifier').on(table.identifier),
  ]
);

export const config = table('config', {
  name: text('name').unique().notNull(),
  value: text('value'),
});

export const taxonomy = table(
  'taxonomy',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    slug: text('slug').unique().notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    image: text('image'),
    icon: text('icon'),
    status: text('status').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp('deleted_at'),
    sort: integer('sort').default(0).notNull(),
  },
  (table) => [
    // Composite: Query taxonomies by type and status
    // Can also be used for: WHERE type = ? (left-prefix)
    index('idx_taxonomy_type_status').on(table.type, table.status),
  ]
);

export const post = table(
  'post',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    slug: text('slug').unique().notNull(),
    type: text('type').notNull(),
    title: text('title'),
    description: text('description'),
    image: text('image'),
    content: text('content'),
    categories: text('categories'),
    tags: text('tags'),
    authorName: text('author_name'),
    authorImage: text('author_image'),
    status: text('status').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp('deleted_at'),
    sort: integer('sort').default(0).notNull(),
  },
  (table) => [
    // Composite: Query posts by type and status
    // Can also be used for: WHERE type = ? (left-prefix)
    index('idx_post_type_status').on(table.type, table.status),
  ]
);

export const order = table(
  'order',
  {
    id: text('id').primaryKey(),
    orderNo: text('order_no').unique().notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    userEmail: text('user_email'), // checkout user email
    status: text('status').notNull(), // created, paid, failed
    amount: integer('amount').notNull(), // checkout amount in cents
    currency: text('currency').notNull(), // checkout currency
    productId: text('product_id'),
    paymentType: text('payment_type'), // one_time, subscription
    paymentInterval: text('payment_interval'), // day, week, month, year
    paymentProvider: text('payment_provider').notNull(),
    paymentSessionId: text('payment_session_id'),
    checkoutInfo: text('checkout_info').notNull(), // checkout request info
    checkoutResult: text('checkout_result'), // checkout result
    paymentResult: text('payment_result'), // payment result
    discountCode: text('discount_code'), // discount code
    discountAmount: integer('discount_amount'), // discount amount in cents
    discountCurrency: text('discount_currency'), // discount currency
    paymentEmail: text('payment_email'), // actual payment email
    paymentAmount: integer('payment_amount'), // actual payment amount
    paymentCurrency: text('payment_currency'), // actual payment currency
    paidAt: timestamp('paid_at'), // paid at
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp('deleted_at'),
    description: text('description'), // order description
    productName: text('product_name'), // product name
    subscriptionId: text('subscription_id'), // provider subscription id
    subscriptionResult: text('subscription_result'), // provider subscription result
    checkoutUrl: text('checkout_url'), // checkout url
    callbackUrl: text('callback_url'), // callback url, after handle callback
    creditsAmount: integer('credits_amount'), // credits amount
    creditsValidDays: integer('credits_valid_days'), // credits validity days
    planName: text('plan_name'), // subscription plan name
    paymentProductId: text('payment_product_id'), // payment product id
    invoiceId: text('invoice_id'),
    invoiceUrl: text('invoice_url'),
    subscriptionNo: text('subscription_no'), // order subscription no
    transactionId: text('transaction_id'), // payment transaction id
    paymentUserName: text('payment_user_name'), // payment user name
    paymentUserId: text('payment_user_id'), // payment user id
  },
  (table) => [
    // Composite: Query user orders by status (most common)
    // Can also be used for: WHERE userId = ? (left-prefix)
    index('idx_order_user_status_payment_type').on(
      table.userId,
      table.status,
      table.paymentType
    ),
    // Composite: Prevent duplicate payments
    // Can also be used for: WHERE transactionId = ? (left-prefix)
    index('idx_order_transaction_provider').on(
      table.transactionId,
      table.paymentProvider
    ),
    // Order orders by creation time for listing
    index('idx_order_created_at').on(table.createdAt),
  ]
);

export const subscription = table(
  'subscription',
  {
    id: text('id').primaryKey(),
    subscriptionNo: text('subscription_no').unique().notNull(), // subscription no
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    userEmail: text('user_email'), // subscription user email
    status: text('status').notNull(), // subscription status
    paymentProvider: text('payment_provider').notNull(),
    subscriptionId: text('subscription_id').notNull(), // provider subscription id
    subscriptionResult: text('subscription_result'), // provider subscription result
    productId: text('product_id'), // product id
    description: text('description'), // subscription description
    amount: integer('amount'), // subscription amount
    currency: text('currency'), // subscription currency
    interval: text('interval'), // subscription interval, day, week, month, year
    intervalCount: integer('interval_count'), // subscription interval count
    trialPeriodDays: integer('trial_period_days'), // subscription trial period days
    currentPeriodStart: timestamp('current_period_start'), // subscription current period start
    currentPeriodEnd: timestamp('current_period_end'), // subscription current period end
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp('deleted_at'),
    planName: text('plan_name'),
    billingUrl: text('billing_url'),
    productName: text('product_name'), // subscription product name
    creditsAmount: integer('credits_amount'), // subscription credits amount
    creditsValidDays: integer('credits_valid_days'), // subscription credits valid days
    paymentProductId: text('payment_product_id'), // subscription payment product id
    paymentUserId: text('payment_user_id'), // subscription payment user id
    canceledAt: timestamp('canceled_at'), // subscription canceled apply at
    canceledEndAt: timestamp('canceled_end_at'), // subscription canceled end at
    canceledReason: text('canceled_reason'), // subscription canceled reason
    canceledReasonType: text('canceled_reason_type'), // subscription canceled reason type
  },
  (table) => [
    // Composite: Query user's subscriptions by status (most common)
    // Can also be used for: WHERE userId = ? (left-prefix)
    index('idx_subscription_user_status_interval').on(
      table.userId,
      table.status,
      table.interval
    ),
    // Composite: Prevent duplicate subscriptions
    // Can also be used for: WHERE paymentProvider = ? (left-prefix)
    index('idx_subscription_provider_id').on(
      table.subscriptionId,
      table.paymentProvider
    ),
    // Order subscriptions by creation time for listing
    index('idx_subscription_created_at').on(table.createdAt),
  ]
);

export const credit = table(
  'credit',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }), // user id
    userEmail: text('user_email'), // user email
    orderNo: text('order_no'), // payment order no
    subscriptionNo: text('subscription_no'), // subscription no
    transactionNo: text('transaction_no').unique().notNull(), // transaction no
    transactionType: text('transaction_type').notNull(), // transaction type, grant / consume
    transactionScene: text('transaction_scene'), // transaction scene, payment / subscription / gift / award
    credits: integer('credits').notNull(), // credits amount, n or -n
    remainingCredits: integer('remaining_credits').notNull().default(0), // remaining credits amount
    description: text('description'), // transaction description
    expiresAt: timestamp('expires_at'), // transaction expires at
    status: text('status').notNull(), // transaction status
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp('deleted_at'),
    consumedDetail: text('consumed_detail'), // consumed detail
    metadata: text('metadata'), // transaction metadata
  },
  (table) => [
    // Critical composite index for credit consumption (FIFO queue)
    // Query: WHERE userId = ? AND transactionType = 'grant' AND status = 'active'
    //        AND remainingCredits > 0 ORDER BY expiresAt
    // Can also be used for: WHERE userId = ? (left-prefix)
    index('idx_credit_consume_fifo').on(
      table.userId,
      table.status,
      table.transactionType,
      table.remainingCredits,
      table.expiresAt
    ),
    // Query credits by order number
    index('idx_credit_order_no').on(table.orderNo),
    // Query credits by subscription number
    index('idx_credit_subscription_no').on(table.subscriptionNo),
  ]
);

export const apikey = table(
  'apikey',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    // Composite: Query user's API keys by status
    // Can also be used for: WHERE userId = ? (left-prefix)
    index('idx_apikey_user_status').on(table.userId, table.status),
    // Composite: Validate active API key (most common for auth)
    // Can also be used for: WHERE key = ? (left-prefix)
    index('idx_apikey_key_status').on(table.key, table.status),
  ]
);

// RBAC Tables
export const role = table(
  'role',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(), // admin, editor, viewer
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    sort: integer('sort').default(0).notNull(),
  },
  (table) => [
    // Query active roles
    index('idx_role_status').on(table.status),
  ]
);

export const permission = table(
  'permission',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(), // admin.users.read, admin.posts.write
    resource: text('resource').notNull(), // users, posts, categories
    action: text('action').notNull(), // read, write, delete
    title: text('title').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // Composite: Query permissions by resource and action
    // Can also be used for: WHERE resource = ? (left-prefix)
    index('idx_permission_resource_action').on(table.resource, table.action),
  ]
);

export const rolePermission = table(
  'role_permission',
  {
    id: text('id').primaryKey(),
    roleId: text('role_id')
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
    permissionId: text('permission_id')
      .notNull()
      .references(() => permission.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    // Composite: Query permissions for a role
    // Can also be used for: WHERE roleId = ? (left-prefix)
    index('idx_role_permission_role_permission').on(
      table.roleId,
      table.permissionId
    ),
  ]
);

export const userRole = table(
  'user_role',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    expiresAt: timestamp('expires_at'),
  },
  (table) => [
    // Composite: Query user's active roles (most critical for auth)
    // Can also be used for: WHERE userId = ? (left-prefix)
    index('idx_user_role_user_expires').on(table.userId, table.expiresAt),
  ]
);

export const aiTask = table(
  'ai_task',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    mediaType: text('media_type').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    prompt: text('prompt').notNull(),
    options: text('options'),
    status: text('status').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp('deleted_at'),
    taskId: text('task_id'), // provider task id
    taskInfo: text('task_info'), // provider task info
    taskResult: text('task_result'), // provider task result
    costCredits: integer('cost_credits').notNull().default(0),
    scene: text('scene').notNull().default(''),
    creditId: text('credit_id'), // credit consumption record id
  },
  (table) => [
    // Composite: Query user's AI tasks by status
    // Can also be used for: WHERE userId = ? (left-prefix)
    index('idx_ai_task_user_media_type').on(table.userId, table.mediaType),
    // Composite: Query user's AI tasks by media type and provider
    // Can also be used for: WHERE mediaType = ? AND provider = ? (left-prefix)
    index('idx_ai_task_media_type_status').on(table.mediaType, table.status),
  ]
);

export const chat = table(
  'chat',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    model: text('model').notNull(),
    provider: text('provider').notNull(),
    title: text('title').notNull().default(''),
    parts: text('parts').notNull(),
    metadata: text('metadata'),
    content: text('content'),
  },
  (table) => [index('idx_chat_user_status').on(table.userId, table.status)]
);

export const chatMessage = table(
  'chat_message',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    chatId: text('chat_id')
      .notNull()
      .references(() => chat.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => new Date())
      .notNull(),
    role: text('role').notNull(),
    parts: text('parts').notNull(),
    metadata: text('metadata'),
    model: text('model').notNull(),
    provider: text('provider').notNull(),
  },
  (table) => [
    index('idx_chat_message_chat_id').on(table.chatId, table.status),
    index('idx_chat_message_user_id').on(table.userId, table.status),
  ]
);

// AlgoCoach learning domain. These tables live beside the authentication tables
// in the configured application schema and are only accessed by the server.
export const coachCatalogSource = table(
  'coach_catalog_source',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    adapter: text('adapter').notNull(),
    baseUrl: text('base_url').notNull(),
    status: text('status').notNull().default('paused'),
    syncEnabled: boolean('sync_enabled').notNull().default(false),
    syncIntervalMinutes: integer('sync_interval_minutes')
      .notNull()
      .default(1440),
    licensePolicy: jsonb('license_policy')
      .notNull()
      .default(sql`'{}'::jsonb`),
    lastSuccessfulRevision: text('last_successful_revision'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_coach_catalog_source_key').on(table.key),
    index('idx_coach_catalog_source_sync').on(table.status, table.syncEnabled),
    check(
      'chk_coach_catalog_source_status',
      sql`${table.status} in ('active', 'paused', 'disabled')`
    ),
    check(
      'chk_coach_catalog_source_interval',
      sql`${table.syncIntervalMinutes} between 5 and 10080`
    ),
  ]
);

export const coachCatalogSyncRun = table(
  'coach_catalog_sync_run',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => coachCatalogSource.id, { onDelete: 'restrict' }),
    trigger: text('trigger').notNull(),
    status: text('status').notNull().default('queued'),
    upstreamRevision: text('upstream_revision'),
    cursor: text('cursor'),
    statistics: jsonb('statistics')
      .notNull()
      .default(sql`'{}'::jsonb`),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_coach_catalog_sync_source_created').on(
      table.sourceId,
      table.createdAt.desc()
    ),
    index('idx_coach_catalog_sync_status_created').on(
      table.status,
      table.createdAt.asc()
    ),
    check(
      'chk_coach_catalog_sync_trigger',
      sql`${table.trigger} in ('scheduled', 'manual', 'webhook')`
    ),
    check(
      'chk_coach_catalog_sync_status',
      sql`${table.status} in ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled')`
    ),
  ]
);

export const coachProblemCandidate = table(
  'coach_problem_candidate',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => coachCatalogSource.id, { onDelete: 'restrict' }),
    syncRunId: text('sync_run_id').references(() => coachCatalogSyncRun.id, {
      onDelete: 'set null',
    }),
    externalId: text('external_id').notNull(),
    upstreamUrl: text('upstream_url').notNull(),
    sourceRevision: text('source_revision').notNull(),
    contentHash: text('content_hash').notNull(),
    licenseSpdx: text('license_spdx').notNull(),
    attribution: text('attribution').notNull(),
    rawPayload: jsonb('raw_payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    rawContentHash: text('raw_content_hash').notNull().default(''),
    draft: jsonb('draft')
      .notNull()
      .default(sql`'{}'::jsonb`),
    draftHash: text('draft_hash').notNull().default(''),
    draftRevision: integer('draft_revision').notNull().default(1),
    policyVersion: text('policy_version')
      .notNull()
      .default('catalog-policy-v1'),
    changeKind: text('change_kind').notNull().default('new'),
    targetProblemId: text('target_problem_id').references(
      (): AnyPgColumn => coachProblem.id,
      { onDelete: 'restrict' }
    ),
    normalizedProblem: jsonb('normalized_problem').notNull(),
    validation: jsonb('validation')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('quarantined'),
    rejectionReason: text('rejection_reason'),
    approvedByUserId: text('approved_by_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedContentHash: text('approved_content_hash'),
    approvedSourceRevision: text('approved_source_revision'),
    approvedDraftHash: text('approved_draft_hash'),
    approvedDraftRevision: integer('approved_draft_revision'),
    approvedPolicyVersion: text('approved_policy_version'),
    publishedByUserId: text('published_by_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_coach_problem_candidate_content').on(
      table.sourceId,
      table.externalId,
      table.contentHash
    ),
    index('idx_coach_problem_candidate_review').on(
      table.status,
      table.updatedAt.asc()
    ),
    index('idx_coach_problem_candidate_sync').on(table.syncRunId),
    index('idx_coach_problem_candidate_target').on(table.targetProblemId),
    check(
      'chk_coach_problem_candidate_status',
      sql`${table.status} in ('discovered', 'drafting', 'quarantined', 'validated', 'approved', 'rejected', 'published', 'archived')`
    ),
    check(
      'chk_coach_problem_candidate_draft_revision',
      sql`${table.draftRevision} > 0`
    ),
    check(
      'chk_coach_problem_candidate_change_kind',
      sql`${table.changeKind} in ('new', 'content_update', 'translation_update', 'metadata_update')`
    ),
    check(
      'chk_coach_problem_candidate_distinct_actors',
      sql`${table.publishedByUserId} is null or ${table.approvedByUserId} is null or ${table.publishedByUserId} <> ${table.approvedByUserId}`
    ),
  ]
);

export const coachCatalogAiGeneration = table(
  'coach_catalog_ai_generation',
  {
    id: text('id').primaryKey(),
    candidateId: text('candidate_id')
      .notNull()
      .references(() => coachProblemCandidate.id, { onDelete: 'restrict' }),
    actorUserId: text('actor_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    kind: text('kind').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    inputHash: text('input_hash').notNull(),
    outputHash: text('output_hash').notNull(),
    status: text('status').notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_coach_catalog_ai_candidate_created').on(
      table.candidateId,
      table.createdAt.desc()
    ),
    check(
      'chk_coach_catalog_ai_kind',
      sql`${table.kind} in ('translation', 'topic_mapping', 'difficulty', 'review_summary')`
    ),
    check(
      'chk_coach_catalog_ai_status',
      sql`${table.status} in ('generated', 'accepted', 'rejected')`
    ),
  ]
);

export const coachProblemRevision = table(
  'coach_problem_revision',
  {
    id: text('id').primaryKey(),
    problemId: text('problem_id')
      .notNull()
      .references((): AnyPgColumn => coachProblem.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: jsonb('title').notNull(),
    description: jsonb('description').notNull(),
    difficulty: text('difficulty').notNull(),
    topics: text('topics')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    entryPoint: text('entry_point').notNull(),
    templates: jsonb('templates').notNull(),
    languageConfigs: jsonb('language_configs').notNull(),
    signature: jsonb('signature'),
    examples: jsonb('examples')
      .notNull()
      .default(sql`'[]'::jsonb`),
    constraints: jsonb('constraints')
      .notNull()
      .default(sql`'[]'::jsonb`),
    hints: jsonb('hints').notNull(),
    reviewPoints: jsonb('review_points')
      .notNull()
      .default(sql`'[]'::jsonb`),
    learningObjectives: jsonb('learning_objectives')
      .notNull()
      .default(sql`'[]'::jsonb`),
    prerequisiteTopics: text('prerequisite_topics')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    solutionPatterns: text('solution_patterns')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    estimatedMinutes: smallint('estimated_minutes').notNull().default(20),
    sourceStatement: text('source_statement'),
    sourceUrl: text('source_url'),
    sourceRevision: text('source_revision'),
    candidateId: text('candidate_id').references(
      () => coachProblemCandidate.id,
      { onDelete: 'restrict' }
    ),
    catalogSourceId: text('catalog_source_id').references(
      () => coachCatalogSource.id,
      { onDelete: 'restrict' }
    ),
    sourceExternalId: text('source_external_id'),
    sourceStatementPath: text('source_statement_path'),
    sourceLicenseSpdx: text('source_license_spdx'),
    sourceLicenseHash: text('source_license_hash'),
    sourceAttribution: text('source_attribution'),
    sourceFetchedAt: timestamp('source_fetched_at', { withTimezone: true }),
    policyVersion: text('policy_version')
      .notNull()
      .default('catalog-policy-legacy'),
    draftRevision: integer('draft_revision').notNull().default(1),
    draftHash: text('draft_hash').notNull().default(''),
    provenance: jsonb('provenance')
      .notNull()
      .default(sql`'{}'::jsonb`),
    catalogVersion: text('catalog_version'),
    contentHash: text('content_hash').notNull(),
    status: text('status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uq_coach_problem_revision_version').on(
      table.problemId,
      table.version
    ),
    uniqueIndex('uq_coach_problem_revision_content').on(
      table.problemId,
      table.contentHash
    ),
    uniqueIndex('uq_coach_problem_revision_id_problem').on(
      table.id,
      table.problemId
    ),
    index('idx_coach_problem_revision_status').on(
      table.problemId,
      table.status,
      table.version.desc()
    ),
    index('idx_coach_problem_revision_candidate').on(table.candidateId),
    check('chk_coach_problem_revision_version', sql`${table.version} > 0`),
    check(
      'chk_coach_problem_revision_draft_revision',
      sql`${table.draftRevision} > 0`
    ),
    check(
      'chk_coach_problem_revision_difficulty',
      sql`${table.difficulty} in ('easy', 'medium', 'hard')`
    ),
    check(
      'chk_coach_problem_revision_status',
      sql`${table.status} in ('draft', 'published', 'archived')`
    ),
    check(
      'chk_coach_problem_revision_estimated_minutes',
      sql`${table.estimatedMinutes} between 1 and 180`
    ),
  ]
);

export const coachProblem = table(
  'coach_problem',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    ownerUserId: text('owner_user_id').references(() => user.id, {
      onDelete: 'cascade',
    }),
    source: text('source').notNull(),
    title: jsonb('title').notNull(),
    description: jsonb('description').notNull(),
    difficulty: text('difficulty').notNull(),
    topics: text('topics')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    entryPoint: text('entry_point').notNull(),
    templates: jsonb('templates').notNull(),
    languageConfigs: jsonb('language_configs')
      .notNull()
      .default(sql`'{}'::jsonb`),
    signature: jsonb('signature'),
    examples: jsonb('examples')
      .notNull()
      .default(sql`'[]'::jsonb`),
    constraints: jsonb('constraints')
      .notNull()
      .default(sql`'[]'::jsonb`),
    hints: jsonb('hints').notNull(),
    reviewPoints: jsonb('review_points')
      .notNull()
      .default(sql`'[]'::jsonb`),
    estimatedMinutes: smallint('estimated_minutes').notNull().default(20),
    status: text('status').notNull().default('published'),
    isActive: boolean('is_active').notNull().default(false),
    sourceStatement: text('source_statement'),
    sourceUrl: text('source_url'),
    contentVersion: integer('content_version').notNull().default(1),
    currentRevisionId: text('current_revision_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_coach_problem_curated_slug')
      .on(table.slug)
      .where(sql`${table.ownerUserId} is null`),
    uniqueIndex('uq_coach_problem_owner_slug')
      .on(table.ownerUserId, table.slug)
      .where(sql`${table.ownerUserId} is not null`),
    uniqueIndex('uq_coach_problem_id_owner').on(table.id, table.ownerUserId),
    uniqueIndex('uq_coach_problem_owner_active')
      .on(table.ownerUserId)
      .where(
        sql`${table.ownerUserId} is not null and ${table.isActive} = true`
      ),
    foreignKey({
      columns: [table.currentRevisionId, table.id],
      foreignColumns: [coachProblemRevision.id, coachProblemRevision.problemId],
      name: 'fk_coach_problem_current_revision_ownership',
    }),
    index('idx_coach_problem_status_difficulty').on(
      table.status,
      table.difficulty
    ),
    index('idx_coach_problem_topics').using('gin', table.topics),
    index('idx_coach_problem_owner_updated').on(
      table.ownerUserId,
      table.updatedAt.desc()
    ),
    check(
      'chk_coach_problem_source',
      sql`${table.source} in ('curated', 'imported', 'external')`
    ),
    check(
      'chk_coach_problem_difficulty',
      sql`${table.difficulty} in ('easy', 'medium', 'hard')`
    ),
    check(
      'chk_coach_problem_status',
      sql`${table.status} in ('draft', 'published', 'archived')`
    ),
    check(
      'chk_coach_problem_estimated_minutes',
      sql`${table.estimatedMinutes} between 1 and 180`
    ),
  ]
);

export const coachProblemOrigin = table(
  'coach_problem_origin',
  {
    id: text('id').primaryKey(),
    problemId: text('problem_id')
      .notNull()
      .references(() => coachProblem.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => coachCatalogSource.id, { onDelete: 'restrict' }),
    externalId: text('external_id').notNull(),
    upstreamUrl: text('upstream_url').notNull(),
    licenseSpdx: text('license_spdx').notNull(),
    attribution: text('attribution').notNull(),
    sourceRevision: text('source_revision').notNull(),
    contentHash: text('content_hash').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_coach_problem_origin_problem').on(table.problemId),
    uniqueIndex('uq_coach_problem_origin_external').on(
      table.sourceId,
      table.externalId
    ),
    index('idx_coach_problem_origin_revision').on(
      table.sourceId,
      table.sourceRevision
    ),
  ]
);

export const coachCatalogReviewAudit = table(
  'coach_catalog_review_audit',
  {
    id: text('id').primaryKey(),
    candidateId: text('candidate_id').references(
      () => coachProblemCandidate.id,
      { onDelete: 'restrict' }
    ),
    problemId: text('problem_id').references(() => coachProblem.id, {
      onDelete: 'restrict',
    }),
    revisionId: text('revision_id').references(() => coachProblemRevision.id, {
      onDelete: 'restrict',
    }),
    reviewerUserId: text('reviewer_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    action: text('action').notNull(),
    notes: text('notes'),
    contentHash: text('content_hash'),
    sourceRevision: text('source_revision'),
    draftHash: text('draft_hash'),
    draftRevision: integer('draft_revision'),
    policyVersion: text('policy_version'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_coach_catalog_review_candidate').on(
      table.candidateId,
      table.createdAt.desc()
    ),
    index('idx_coach_catalog_review_problem').on(
      table.problemId,
      table.createdAt.desc()
    ),
    check(
      'chk_coach_catalog_review_action',
      sql`${table.action} in ('submitted', 'draft_updated', 'approved', 'rejected', 'published', 'archived', 'rolled_back')`
    ),
    check(
      'chk_coach_catalog_review_subject',
      sql`${table.candidateId} is not null or ${table.problemId} is not null or ${table.revisionId} is not null`
    ),
  ]
);

export const coachCatalogAdminMutation = table(
  'coach_catalog_admin_mutation',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status').notNull().default('claimed'),
    result: jsonb('result')
      .notNull()
      .default(sql`'{}'::jsonb`),
    errorCode: text('error_code'),
    claimedAt: timestamp('claimed_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '5 minutes'`),
    attemptCount: integer('attempt_count').notNull().default(1),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_coach_catalog_admin_mutation_actor_key').on(
      table.actorUserId,
      table.idempotencyKey
    ),
    index('idx_coach_catalog_admin_mutation_status').on(
      table.status,
      table.leaseExpiresAt.asc()
    ),
    check(
      'chk_coach_catalog_admin_mutation_action',
      sql`${table.action} in ('update_draft', 'validate', 'approve', 'reject', 'publish', 'rollback', 'bootstrap')`
    ),
    check(
      'chk_coach_catalog_admin_mutation_target',
      sql`${table.targetType} in ('candidate', 'problem', 'revision', 'catalog')`
    ),
    check(
      'chk_coach_catalog_admin_mutation_status',
      sql`${table.status} in ('claimed', 'completed', 'failed')`
    ),
    check(
      'chk_coach_catalog_admin_mutation_attempt_count',
      sql`${table.attemptCount} between 1 and 1000`
    ),
  ]
);

export const coachTestCase = table(
  'coach_test_case',
  {
    id: text('id').primaryKey(),
    problemId: text('problem_id')
      .notNull()
      .references(() => coachProblem.id, { onDelete: 'cascade' }),
    revisionId: text('revision_id').notNull(),
    ordinal: smallint('ordinal').notNull(),
    args: jsonb('args').notNull(),
    expected: jsonb('expected').notNull(),
    isSample: boolean('is_sample').notNull().default(false),
    label: jsonb('label'),
    timeoutMs: integer('timeout_ms').notNull().default(3000),
    sourceKind: text('source_kind').notNull().default('legacy'),
    sourceTestUuid: text('source_test_uuid'),
    reviewNote: text('review_note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_coach_test_case_revision_ordinal')
      .on(table.revisionId, table.ordinal)
      .where(sql`${table.revisionId} is not null`),
    foreignKey({
      columns: [table.revisionId, table.problemId],
      foreignColumns: [coachProblemRevision.id, coachProblemRevision.problemId],
      name: 'fk_coach_test_case_revision_ownership',
    }).onDelete('cascade'),
    index('idx_coach_test_case_problem_sample').on(
      table.problemId,
      table.isSample,
      table.ordinal
    ),
    check('chk_coach_test_case_ordinal', sql`${table.ordinal} >= 0`),
    check(
      'chk_coach_test_case_args_array',
      sql`jsonb_typeof(${table.args}) = 'array'`
    ),
    check(
      'chk_coach_test_case_timeout',
      sql`${table.timeoutMs} between 100 and 10000`
    ),
    check(
      'chk_coach_test_case_source_kind',
      sql`${table.sourceKind} in ('canonical', 'manual', 'legacy')`
    ),
    check(
      'chk_coach_test_case_source_evidence',
      sql`(${table.sourceKind} = 'canonical' and ${table.sourceTestUuid} is not null) or (${table.sourceKind} = 'manual' and nullif(btrim(${table.reviewNote}), '') is not null) or ${table.sourceKind} = 'legacy'`
    ),
  ]
);

export const coachImportedTestCase = table(
  'coach_imported_test_case',
  {
    id: text('id').primaryKey(),
    problemId: text('problem_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    ordinal: smallint('ordinal').notNull(),
    args: jsonb('args').notNull(),
    expected: jsonb('expected').notNull(),
    isSample: boolean('is_sample').notNull().default(false),
    label: jsonb('label'),
    timeoutMs: integer('timeout_ms').notNull().default(3000),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_coach_imported_test_case_problem_ordinal').on(
      table.problemId,
      table.ordinal
    ),
    index('idx_coach_imported_test_case_owner_problem').on(
      table.ownerUserId,
      table.problemId
    ),
    foreignKey({
      columns: [table.problemId, table.ownerUserId],
      foreignColumns: [coachProblem.id, coachProblem.ownerUserId],
      name: 'fk_coach_imported_test_case_problem_owner',
    }).onDelete('cascade'),
    check(
      'chk_coach_imported_test_case_timeout',
      sql`${table.timeoutMs} between 100 and 10000`
    ),
  ]
);

export const coachLearningProfile = table(
  'coach_learning_profile',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    goal: text('goal').notNull(),
    preferredLanguage: text('preferred_language').notNull(),
    weeklyTarget: smallint('weekly_target').notNull().default(5),
    dailyMinutes: smallint('daily_minutes').notNull().default(30),
    onboardingCompleted: boolean('onboarding_completed')
      .notNull()
      .default(false),
    hintExperimentVariant: text('hint_experiment_variant'),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    check(
      'chk_coach_learning_profile_goal',
      sql`${table.goal} in ('foundation', 'interview', 'contest')`
    ),
    check(
      'chk_coach_learning_profile_language',
      sql`${table.preferredLanguage} in ('javascript', 'python', 'typescript')`
    ),
    check(
      'chk_coach_learning_profile_weekly_target',
      sql`${table.weeklyTarget} between 1 and 14`
    ),
    check(
      'chk_coach_learning_profile_daily_minutes',
      sql`${table.dailyMinutes} between 10 and 180`
    ),
    check(
      'chk_coach_learning_profile_experiment',
      sql`${table.hintExperimentVariant} is null or ${table.hintExperimentVariant} in ('A', 'B')`
    ),
  ]
);

export const coachSyncState = table(
  'coach_sync_state',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    check('chk_coach_sync_state_revision', sql`${table.revision} >= 0`),
  ]
);

export const coachSyncMutation = table(
  'coach_sync_mutation',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    mutationId: text('mutation_id').notNull(),
    resultRevision: integer('result_revision').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_coach_sync_mutation_user_id').on(
      table.userId,
      table.mutationId
    ),
    index('idx_coach_sync_mutation_user_created').on(
      table.userId,
      table.createdAt.desc()
    ),
    check(
      'chk_coach_sync_mutation_result_revision',
      sql`${table.resultRevision} >= 0`
    ),
  ]
);

export const coachReviewItem = table(
  'coach_review_item',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    problemSlug: text('problem_slug').notNull(),
    problemContentVersion: integer('problem_content_version')
      .notNull()
      .default(1),
    status: text('status').notNull(),
    source: text('source').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    intervalDays: integer('interval_days').notNull(),
    repetitions: integer('repetitions').notNull(),
    easeFactor: doublePrecision('ease_factor').notNull(),
    lastObservedRunAt: timestamp('last_observed_run_at', {
      withTimezone: true,
    }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    lastRating: text('last_rating'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_coach_review_item_user_problem').on(
      table.userId,
      table.problemSlug,
      table.problemContentVersion
    ),
    index('idx_coach_review_item_user_due').on(table.userId, table.dueAt.asc()),
    index('idx_coach_review_item_user_status').on(
      table.userId,
      table.status,
      table.updatedAt.desc()
    ),
    check(
      'chk_coach_review_item_version',
      sql`${table.problemContentVersion} > 0`
    ),
    check(
      'chk_coach_review_item_status',
      sql`${table.status} in ('due', 'resolved', 'mastered')`
    ),
    check(
      'chk_coach_review_item_source',
      sql`${table.source} in ('mistake', 'completion')`
    ),
    check(
      'chk_coach_review_item_interval',
      sql`${table.intervalDays} between 1 and 365`
    ),
    check(
      'chk_coach_review_item_repetitions',
      sql`${table.repetitions} between 0 and 1000`
    ),
    check(
      'chk_coach_review_item_ease_factor',
      sql`${table.easeFactor} between 1.3 and 3.2`
    ),
    check(
      'chk_coach_review_item_rating',
      sql`${table.lastRating} is null or ${table.lastRating} in ('again', 'hard', 'good', 'easy')`
    ),
  ]
);

export const coachDailyLearningPlan = table(
  'coach_daily_learning_plan',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    clientPlanId: text('client_plan_id').notNull(),
    localDate: text('local_date').notNull(),
    timeZone: text('time_zone').notNull(),
    budgetMinutes: smallint('budget_minutes').notNull(),
    estimatedMinutes: smallint('estimated_minutes').notNull(),
    preferredLanguage: text('preferred_language'),
    goal: text('goal').notNull(),
    tasks: jsonb('tasks')
      .notNull()
      .default(sql`'[]'::jsonb`),
    changes: jsonb('changes')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_coach_daily_plan_user_client').on(
      table.userId,
      table.clientPlanId
    ),
    uniqueIndex('uq_coach_daily_plan_user_date_zone').on(
      table.userId,
      table.localDate,
      table.timeZone
    ),
    index('idx_coach_daily_plan_user_date').on(
      table.userId,
      table.localDate.desc()
    ),
    check(
      'chk_coach_daily_plan_date',
      sql`${table.localDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`
    ),
    check(
      'chk_coach_daily_plan_budget',
      sql`${table.budgetMinutes} between 1 and 180`
    ),
    check(
      'chk_coach_daily_plan_estimate',
      sql`${table.estimatedMinutes} between 0 and 540`
    ),
    check(
      'chk_coach_daily_plan_language',
      sql`${table.preferredLanguage} is null or ${table.preferredLanguage} in ('javascript', 'python', 'typescript')`
    ),
    check(
      'chk_coach_daily_plan_goal',
      sql`${table.goal} in ('foundation', 'interview', 'contest')`
    ),
    check(
      'chk_coach_daily_plan_tasks',
      sql`jsonb_typeof(${table.tasks}) = 'array'`
    ),
    check(
      'chk_coach_daily_plan_changes',
      sql`jsonb_typeof(${table.changes}) = 'array'`
    ),
  ]
);

export const coachReviewAttempt = table(
  'coach_review_attempt',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    clientAttemptId: text('client_attempt_id').notNull(),
    problemId: text('problem_id').references(() => coachProblem.id, {
      onDelete: 'set null',
    }),
    problemSlugSnapshot: text('problem_slug_snapshot').notNull(),
    problemContentVersion: integer('problem_content_version')
      .notNull()
      .default(1),
    answer: text('answer').notNull(),
    grade: jsonb('grade'),
    selectedRating: text('selected_rating'),
    ratingOverride: text('rating_override'),
    gradedArtifactId: text('graded_artifact_id'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_coach_review_attempt_user_client').on(
      table.userId,
      table.clientAttemptId
    ),
    index('idx_coach_review_attempt_user_submitted').on(
      table.userId,
      table.submittedAt.desc()
    ),
    index('idx_coach_review_attempt_problem').on(
      table.userId,
      table.problemSlugSnapshot,
      table.problemContentVersion
    ),
    check(
      'chk_coach_review_attempt_version',
      sql`${table.problemContentVersion} > 0`
    ),
    check(
      'chk_coach_review_attempt_selected',
      sql`${table.selectedRating} is null or ${table.selectedRating} in ('again', 'hard', 'good', 'easy')`
    ),
    check(
      'chk_coach_review_attempt_override',
      sql`${table.ratingOverride} is null or ${table.ratingOverride} in ('again', 'hard', 'good', 'easy')`
    ),
  ]
);

export const coachCorrectionEpisode = table(
  'coach_correction_episode',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    clientEpisodeId: text('client_episode_id').notNull(),
    problemId: text('problem_id').references(() => coachProblem.id, {
      onDelete: 'set null',
    }),
    problemSlugSnapshot: text('problem_slug_snapshot').notNull(),
    problemContentVersion: integer('problem_content_version')
      .notNull()
      .default(1),
    diagnosisCategory: text('diagnosis_category').notNull(),
    payload: jsonb('payload').notNull(),
    resolved: boolean('resolved').notNull().default(false),
    passedWithinThreeRuns: boolean('passed_within_three_runs')
      .notNull()
      .default(false),
    repairDurationMs: integer('repair_duration_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    diagnosedAt: timestamp('diagnosed_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_coach_correction_episode_user_client').on(
      table.userId,
      table.clientEpisodeId
    ),
    index('idx_coach_correction_episode_user_started').on(
      table.userId,
      table.startedAt.desc()
    ),
    index('idx_coach_correction_episode_effect').on(
      table.userId,
      table.resolved,
      table.passedWithinThreeRuns
    ),
    check(
      'chk_coach_correction_episode_version',
      sql`${table.problemContentVersion} > 0`
    ),
    check(
      'chk_coach_correction_episode_category',
      sql`${table.diagnosisCategory} in ('syntax', 'runtime', 'timeout', 'wrong-answer', 'edge-case', 'unknown')`
    ),
    check(
      'chk_coach_correction_episode_duration',
      sql`${table.repairDurationMs} is null or ${table.repairDurationMs} >= 0`
    ),
  ]
);

export const coachPracticeSession = table(
  'coach_practice_session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    problemId: text('problem_id').references(() => coachProblem.id, {
      onDelete: 'set null',
    }),
    problemSlugSnapshot: text('problem_slug_snapshot').notNull(),
    problemContentVersion: integer('problem_content_version')
      .notNull()
      .default(1),
    code: jsonb('code')
      .notNull()
      .default(sql`'{}'::jsonb`),
    hintLevel: smallint('hint_level').notNull().default(0),
    diagnosisCount: integer('diagnosis_count').notNull().default(0),
    correctedAfterDiagnosis: boolean('corrected_after_diagnosis')
      .notNull()
      .default(false),
    status: text('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uq_coach_practice_session_user_problem').on(
      table.userId,
      table.problemSlugSnapshot,
      table.problemContentVersion
    ),
    index('idx_coach_practice_session_user_updated').on(
      table.userId,
      table.updatedAt.desc()
    ),
    index('idx_coach_practice_session_user_completed').on(
      table.userId,
      table.completedAt.desc()
    ),
    check(
      'chk_coach_practice_session_hint_level',
      sql`${table.hintLevel} between 0 and 3`
    ),
    check(
      'chk_coach_practice_session_diagnosis_count',
      sql`${table.diagnosisCount} >= 0`
    ),
    check(
      'chk_coach_practice_session_problem_version',
      sql`${table.problemContentVersion} > 0`
    ),
    check(
      'chk_coach_practice_session_status',
      sql`${table.status} in ('active', 'completed', 'abandoned')`
    ),
  ]
);

export const coachCodeRun = table(
  'coach_code_run',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => coachPracticeSession.id, { onDelete: 'cascade' }),
    problemId: text('problem_id').references(() => coachProblem.id, {
      onDelete: 'set null',
    }),
    problemSlugSnapshot: text('problem_slug_snapshot').notNull(),
    problemContentVersion: integer('problem_content_version')
      .notNull()
      .default(1),
    language: text('language').notNull(),
    runtimeVersion: text('runtime_version').notNull().default('unknown'),
    runnerMode: text('runner_mode').notNull().default('browser-worker'),
    codeSnapshot: text('code_snapshot').notNull().default(''),
    status: text('status').notNull(),
    passedTests: smallint('passed_tests').notNull(),
    totalTests: smallint('total_tests').notNull(),
    testResults: jsonb('test_results')
      .notNull()
      .default(sql`'[]'::jsonb`),
    console: jsonb('console')
      .notNull()
      .default(sql`'[]'::jsonb`),
    error: text('error'),
    durationMs: integer('duration_ms').notNull(),
    testScope: text('test_scope').notNull().default('unknown'),
    submitted: boolean('submitted').notNull().default(false),
    executedAt: timestamp('executed_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('idx_coach_code_run_session_executed').on(
      table.sessionId,
      table.executedAt.desc()
    ),
    index('idx_coach_code_run_session_submitted').on(
      table.sessionId,
      table.submitted,
      table.executedAt.desc()
    ),
    check(
      'chk_coach_code_run_language',
      sql`${table.language} in ('javascript', 'python', 'typescript')`
    ),
    check(
      'chk_coach_code_run_status',
      sql`${table.status} in ('passed', 'failed', 'syntax_error', 'runtime_error', 'timeout')`
    ),
    check(
      'chk_coach_code_run_counts',
      sql`${table.passedTests} >= 0 and ${table.totalTests} >= 0 and ${table.passedTests} <= ${table.totalTests}`
    ),
    check('chk_coach_code_run_duration', sql`${table.durationMs} >= 0`),
    check(
      'chk_coach_code_run_problem_version',
      sql`${table.problemContentVersion} > 0`
    ),
    check(
      'chk_coach_code_run_runner_mode',
      sql`${table.runnerMode} in ('browser-worker', 'remote-judge')`
    ),
    check(
      'chk_coach_code_run_test_scope',
      sql`${table.testScope} in ('sample', 'full', 'unknown')`
    ),
  ]
);

export const coachLearningArtifact = table(
  'coach_learning_artifact',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => coachPracticeSession.id, {
      onDelete: 'cascade',
    }),
    problemId: text('problem_id').references(() => coachProblem.id, {
      onDelete: 'set null',
    }),
    runId: text('run_id').references(() => coachCodeRun.id, {
      onDelete: 'set null',
    }),
    problemSlugSnapshot: text('problem_slug_snapshot'),
    problemContentVersion: integer('problem_content_version')
      .notNull()
      .default(1),
    type: text('type').notNull(),
    locale: text('locale').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    details: jsonb('details')
      .notNull()
      .default(sql`'[]'::jsonb`),
    evidence: jsonb('evidence')
      .notNull()
      .default(sql`'[]'::jsonb`),
    nextAction: text('next_action'),
    diagnosisCategory: text('diagnosis_category'),
    hint: jsonb('hint'),
    counterexample: jsonb('counterexample'),
    reviewCard: jsonb('review_card'),
    reviewGrade: jsonb('review_grade'),
    draft: jsonb('draft'),
    generationMode: text('generation_mode').notNull().default('live'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    traceId: text('trace_id'),
    latencyMs: integer('latency_ms'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_coach_learning_artifact_trace')
      .on(table.traceId)
      .where(sql`${table.traceId} is not null`),
    index('idx_coach_learning_artifact_user_created').on(
      table.userId,
      table.createdAt.desc()
    ),
    index('idx_coach_learning_artifact_user_type').on(
      table.userId,
      table.type,
      table.createdAt.desc()
    ),
    index('idx_coach_learning_artifact_problem_type').on(
      table.problemId,
      table.type,
      table.createdAt.desc()
    ),
    check(
      'chk_coach_learning_artifact_type',
      sql`${table.type} in ('parse', 'diagnose', 'hint', 'counterexample', 'review_card', 'review_grade')`
    ),
    check(
      'chk_coach_learning_artifact_locale',
      sql`${table.locale} in ('zh', 'en')`
    ),
    check(
      'chk_coach_learning_artifact_diagnosis',
      sql`${table.diagnosisCategory} is null or ${table.diagnosisCategory} in ('syntax', 'runtime', 'timeout', 'wrong-answer', 'edge-case', 'unknown')`
    ),
    check(
      'chk_coach_learning_artifact_generation_mode',
      sql`${table.generationMode} in ('live', 'local')`
    ),
    check(
      'chk_coach_learning_artifact_latency',
      sql`${table.latencyMs} is null or ${table.latencyMs} >= 0`
    ),
    check(
      'chk_coach_learning_artifact_problem_version',
      sql`${table.problemContentVersion} > 0`
    ),
  ]
);

export const coachAssessment = table(
  'coach_assessment',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('practice'),
    baselineAssessmentId: text('baseline_assessment_id'),
    problemSlugs: text('problem_slugs')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    problemVersions: jsonb('problem_versions')
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: text('status').notNull().default('active'),
    durationMinutes: smallint('duration_minutes').notNull().default(20),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    score: smallint('score'),
    correctCount: smallint('correct_count'),
    totalCount: smallint('total_count'),
    weakTopics: text('weak_topics')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    recommendation: text('recommendation').notNull().default(''),
    averageDurationMs: integer('average_duration_ms'),
    hintCount: integer('hint_count').notNull().default(0),
    errorCategories: text('error_categories')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    comparison: jsonb('comparison'),
    assessmentVersion: text('assessment_version'),
    verificationToken: text('verification_token'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('idx_coach_assessment_user_started').on(
      table.userId,
      table.startedAt.desc()
    ),
    index('idx_coach_assessment_user_completed').on(
      table.userId,
      table.completedAt.desc()
    ),
    check(
      'chk_coach_assessment_status',
      sql`${table.status} in ('active', 'completed', 'abandoned')`
    ),
    check(
      'chk_coach_assessment_kind',
      sql`${table.kind} in ('baseline', 'checkpoint', 'practice')`
    ),
    check(
      'chk_coach_assessment_duration',
      sql`${table.durationMinutes} between 1 and 180`
    ),
    check(
      'chk_coach_assessment_score',
      sql`${table.score} is null or ${table.score} between 0 and 100`
    ),
    check(
      'chk_coach_assessment_counts',
      sql`(${table.correctCount} is null and ${table.totalCount} is null) or (${table.correctCount} >= 0 and ${table.totalCount} >= 0 and ${table.correctCount} <= ${table.totalCount})`
    ),
    check(
      'chk_coach_assessment_problem_versions',
      sql`jsonb_typeof(${table.problemVersions}) = 'array'`
    ),
    check(
      'chk_coach_assessment_average_duration',
      sql`${table.averageDurationMs} is null or ${table.averageDurationMs} >= 0`
    ),
    check('chk_coach_assessment_hint_count', sql`${table.hintCount} >= 0`),
  ]
);

export const coachProductEvent = table(
  'coach_product_event',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    name: text('name').notNull(),
    problemId: text('problem_id').references(() => coachProblem.id, {
      onDelete: 'set null',
    }),
    problemSlugSnapshot: text('problem_slug_snapshot'),
    properties: jsonb('properties')
      .notNull()
      .default(sql`'{}'::jsonb`),
    experimentVariant: text('experiment_variant'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_coach_product_event_user_occurred').on(
      table.userId,
      table.occurredAt.desc()
    ),
    index('idx_coach_product_event_name_occurred').on(
      table.name,
      table.occurredAt.desc()
    ),
    index('idx_coach_product_event_problem_name').on(
      table.problemId,
      table.name,
      table.occurredAt.desc()
    ),
    index('idx_coach_product_event_session_occurred').on(
      table.sessionId,
      table.occurredAt.desc()
    ),
    check(
      'chk_coach_product_event_name',
      sql`${table.name} in ('activated', 'visitor_started', 'onboarding_started', 'practice_started', 'first_code_run', 'first_problem_passed', 'code_run', 'code_submitted', 'hint_revealed', 'diagnosis_requested', 'corrected_after_diagnosis', 'assessment_started', 'assessment_completed', 'baseline_started', 'baseline_completed', 'checkpoint_completed', 'daily_plan_viewed', 'daily_plan_task_started', 'daily_plan_task_swapped', 'daily_plan_task_skipped', 'daily_plan_task_completed', 'review_answered', 'review_rating_overridden', 'correction_episode_completed', 'counterexample_requested', 'review_card_created', 'review_completed', 'coach_chat_message', 'csat_submitted', 'guest_data_claimed', 'sync_succeeded', 'sync_failed', 'language_selected', 'typescript_transpile_failed', 'experiment_exposed', 'imported_problem_saved', 'catalog_sync_completed', 'catalog_candidate_rejected', 'catalog_revision_published', 'catalog_revision_rolled_back')`
    ),
    check(
      'chk_coach_product_event_experiment',
      sql`${table.experimentVariant} is null or ${table.experimentVariant} in ('A', 'B')`
    ),
  ]
);
