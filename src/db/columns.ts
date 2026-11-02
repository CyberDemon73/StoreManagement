import { customType } from 'drizzle-orm/pg-core';

/** Postgres citext (case-insensitive text); requires the citext extension (migration 0000). */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});
