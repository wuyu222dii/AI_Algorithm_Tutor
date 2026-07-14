import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
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
    uniqueIndex('uq_coach_problem_owner_active')
      .on(table.ownerUserId)
      .where(
        sql`${table.ownerUserId} is not null and ${table.isActive} = true`
      ),
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
      sql`${table.source} in ('curated', 'imported')`
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

export const coachTestCase = table(
  'coach_test_case',
  {
    id: text('id').primaryKey(),
    problemId: text('problem_id')
      .notNull()
      .references(() => coachProblem.id, { onDelete: 'cascade' }),
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
    uniqueIndex('uq_coach_test_case_problem_ordinal').on(
      table.problemId,
      table.ordinal
    ),
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
      sql`${table.preferredLanguage} in ('javascript', 'python')`
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
      table.problemSlug
    ),
    index('idx_coach_review_item_user_due').on(table.userId, table.dueAt.asc()),
    index('idx_coach_review_item_user_status').on(
      table.userId,
      table.status,
      table.updatedAt.desc()
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
      table.problemSlugSnapshot
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
    language: text('language').notNull(),
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
      sql`${table.language} in ('javascript', 'python')`
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
      sql`${table.type} in ('parse', 'diagnose', 'hint', 'counterexample', 'review_card')`
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
  ]
);

export const coachAssessment = table(
  'coach_assessment',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    problemSlugs: text('problem_slugs')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
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
      sql`${table.name} in ('activated', 'visitor_started', 'onboarding_started', 'practice_started', 'first_code_run', 'first_problem_passed', 'code_run', 'code_submitted', 'hint_revealed', 'diagnosis_requested', 'corrected_after_diagnosis', 'assessment_started', 'assessment_completed', 'counterexample_requested', 'review_card_created', 'review_completed', 'coach_chat_message', 'csat_submitted', 'guest_data_claimed', 'sync_succeeded', 'sync_failed', 'experiment_exposed', 'imported_problem_saved')`
    ),
    check(
      'chk_coach_product_event_experiment',
      sql`${table.experimentVariant} is null or ${table.experimentVariant} in ('A', 'B')`
    ),
  ]
);
