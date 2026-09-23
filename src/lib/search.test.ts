import { describe, expect, it } from 'vitest';
import { dateRange, matchesFilter, searchFiles } from './search';
import { file, now } from '../test/fixtures';

describe('an explicit, local search index', () => {
  it('matches filenames and indexed document text case-insensitively', () => {
    expect(matchesFilter(file({ name: 'PROJECT Notes.txt' }), { text: 'project' })).toBe(true);
    expect(
      matchesFilter(file({ summary: 'Meeting with North Studio' }), { text: 'north studio' }),
    ).toBe(true);
  });
  it('does not match unrelated words or trashed items', () => {
    expect(matchesFilter(file(), { text: 'vacation' })).toBe(false);
    expect(matchesFilter(file({ trashedAt: now.getTime() }), {})).toBe(false);
  });
  it('treats CV, resume and résumé as aliases, not arbitrary semantic guesses', () => {
    for (const name of ['Alex CV.pdf', 'Alex resume.pdf', 'Alex résumé.pdf'])
      expect(matchesFilter(file({ name }), { text: 'cv' })).toBe(true);
    expect(matchesFilter(file({ name: 'CVS budget.csv' }), { text: 'cv' })).toBe(false);
  });
  it('applies date bounds inclusively at the start and exclusively at the end', () => {
    expect(
      matchesFilter(file({ modifiedAt: 100 }), { modifiedAfter: 100, modifiedBefore: 200 }),
    ).toBe(true);
    expect(
      matchesFilter(file({ modifiedAt: 200 }), { modifiedAfter: 100, modifiedBefore: 200 }),
    ).toBe(false);
  });
  it('combines category, name pattern, folder, extension, and size filters', () => {
    const image = file({
      category: 'images',
      extension: 'png',
      name: 'Screenshot yesterday.png',
      size: 1024,
    });
    expect(
      matchesFilter(image, {
        category: 'images',
        extension: '.png',
        nameIncludes: 'screenshot',
        parentId: 'downloads',
        minSize: 500,
      }),
    ).toBe(true);
    expect(matchesFilter(image, { category: 'documents' })).toBe(false);
    expect(matchesFilter(image, { parentId: 'personal' })).toBe(false);
  });
  it('returns deterministic recency ordering', () => {
    expect(
      searchFiles(
        [file({ id: 'older', modifiedAt: 1 }), file({ id: 'newer', modifiedAt: 2 })],
        {},
      ).map((item) => item.id),
    ).toEqual(['newer', 'older']);
  });
});
describe('calendar-aware dates', () => {
  it('uses calendar months, not an approximate 30-day offset', () => {
    const range = dateRange('edited last month', now);
    expect(range).toEqual({
      modifiedAfter: new Date(2026, 7, 1).getTime(),
      modifiedBefore: new Date(2026, 8, 1).getTime(),
    });
  });
  it('handles the January year boundary', () => {
    expect(dateRange('last month', new Date(2026, 0, 12))).toEqual({
      modifiedAfter: new Date(2025, 11, 1).getTime(),
      modifiedBefore: new Date(2026, 0, 1).getTime(),
    });
  });
  it('covers only yesterday’s local calendar day', () => {
    const range = dateRange('yesterday’s screenshots', now);
    expect(range).toEqual({
      modifiedAfter: new Date(2026, 8, 21).getTime(),
      modifiedBefore: new Date(2026, 8, 22).getTime(),
    });
  });
  it('supports today, this month, past week, and past N days', () => {
    expect(dateRange('today', now).modifiedAfter).toBe(new Date(2026, 8, 22).getTime());
    expect(dateRange('this month', now).modifiedAfter).toBe(new Date(2026, 8, 1).getTime());
    expect(dateRange('past week', now).modifiedAfter).toBe(new Date(2026, 8, 15).getTime());
    expect(dateRange('past 3 days', now).modifiedAfter).toBe(new Date(2026, 8, 19).getTime());
  });
});
