import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';

export const settings = pgTable(
  'settings',
  {
    id: integer('id').primaryKey().default(1),
    storeName: text('store_name').notNull().default('Avenue Brand'),
    logoUrl: text('logo_url'),
    phone: text('phone'),
    address: text('address'),
    currency: char('currency', { length: 3 }).notNull().default('EGP'),
    timezone: text('timezone').notNull().default('Africa/Cairo'),
    lowStockDefault: integer('low_stock_default').notNull().default(3),
    saleNumberPrefix: text('sale_number_prefix').notNull().default('AS'),
    sellerDiscountCapPct: numeric('seller_discount_cap_pct', { precision: 5, scale: 2 }).notNull().default('10'),
    allowNegativeStock: boolean('allow_negative_stock').notNull().default(false),
    receiptHeader: text('receipt_header'),
    receiptFooter: text('receipt_footer'),
    sizePresets: jsonb('size_presets').$type<{ name: string; sizes: string[] }[]>().notNull().default([]),
    colorPresets: jsonb('color_presets').$type<{ name: string; hex: string }[]>().notNull().default([]),
    sessionIdleHours: integer('session_idle_hours').notNull().default(12),
    sessionAbsoluteDays: integer('session_absolute_days').notNull().default(30),
    dateFormat: text('date_format').notNull().default('DD/MM/YYYY'),
    requirePhoneOnTransfer: boolean('require_phone_on_transfer').notNull().default(false),
    receiptShowLogo: boolean('receipt_show_logo').notNull().default(true),
    /** Refunds above this (minor units) notify managers. */
    largeRefundAlert: integer('large_refund_alert').notNull().default(100000),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('settings_single_row', sql`${t.id} = 1`)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_created_at_idx').on(t.createdAt.desc()),
    index('audit_log_entity_idx').on(t.entity, t.entityId),
    index('audit_log_user_id_idx').on(t.userId),
  ],
);

export const notificationKindEnum = pgEnum('notification_kind', ['LOW_STOCK', 'LARGE_REFUND', 'NEW_DEVICE_LOGIN', 'COUNT_APPLIED', 'ACCOUNT_RESET', 'SYSTEM']);

/** One row per recipient, so read state is per user. dedupeKey suppresses repeats while unread. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: notificationKindEnum('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    href: text('href'),
    actionLabel: text('action_label'),
    dedupeKey: text('dedupe_key'),
    payload: jsonb('payload'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_read_created_idx').on(t.userId, t.readAt, t.createdAt.desc()),
    uniqueIndex('notifications_unread_dedupe_unique').on(t.userId, t.dedupeKey).where(sql`${t.readAt} is null and ${t.dedupeKey} is not null`),
  ],
);

export type SettingsRow = typeof settings.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
