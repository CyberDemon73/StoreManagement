import { describe, expect, it, vi } from 'vitest';
import { listAllPages, MAX_PAGE_SIZE } from '@/lib/paging';

function fakeList(total: number) {
  return vi.fn(async (page: number, pageSize: number) => {
    const start = (page - 1) * pageSize;
    const data = Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, i) => start + i);
    return { data, page, pageSize, total };
  });
}

describe('listAllPages', () => {
  it('requests pages at the API maximum and concatenates them', async () => {
    const load = fakeList(250);
    const all = await listAllPages(load);
    expect(MAX_PAGE_SIZE).toBe(100);
    expect(load.mock.calls.map(([p, s]) => [p, s])).toEqual([[1, 100], [2, 100], [3, 100]]);
    expect(all.data).toHaveLength(250);
    expect(all.data[249]).toBe(249);
    expect(all.total).toBe(250);
  });

  it('makes a single request when everything fits on one page', async () => {
    const load = fakeList(3);
    expect((await listAllPages(load)).data).toEqual([0, 1, 2]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('stops at the page cap instead of looping forever', async () => {
    const load = fakeList(10_000);
    const all = await listAllPages(load, 5);
    expect(load).toHaveBeenCalledTimes(5);
    expect(all.data).toHaveLength(500);
  });
});
