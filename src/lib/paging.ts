/** The API rejects `pageSize` above this (src/schemas/common.ts `paginationQuery`). */
export const MAX_PAGE_SIZE = 100;

export interface Page<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Fetch every page of a paginated list at the API's maximum page size. Screens that need a
 * whole set (a day's sales, the products in a count scope) use this instead of asking for one
 * oversized page, which the API answers with 400. `maxPages` bounds runaway loops.
 */
export async function listAllPages<T>(
  load: (page: number, pageSize: number) => Promise<Page<T>>,
  maxPages = 50,
): Promise<Page<T>> {
  const first = await load(1, MAX_PAGE_SIZE);
  const data = [...first.data];
  for (let page = 2; page <= maxPages && data.length < first.total; page++) {
    const next = await load(page, MAX_PAGE_SIZE);
    if (next.data.length === 0) break;
    data.push(...next.data);
  }
  return { data, page: 1, pageSize: data.length, total: first.total };
}
