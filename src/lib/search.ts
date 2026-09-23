import type { FileItem, SearchFilter } from './types';

export function matchesFilter(file: FileItem, filter: SearchFilter): boolean {
  if (file.trashedAt) return false;
  if (filter.category && (file.category !== filter.category || file.kind === 'folder'))
    return false;
  if (filter.extension && file.extension !== filter.extension.toLowerCase().replace(/^\./, ''))
    return false;
  if (filter.modifiedAfter !== undefined && file.modifiedAt < filter.modifiedAfter) return false;
  if (filter.modifiedBefore !== undefined && file.modifiedAt >= filter.modifiedBefore) return false;
  if (filter.minSize !== undefined && file.size < filter.minSize) return false;
  if (filter.parentId && file.parentId !== filter.parentId) return false;
  if (filter.nameIncludes && !file.name.toLowerCase().includes(filter.nameIncludes.toLowerCase()))
    return false;
  if (filter.text) {
    const terms = filter.text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const haystack = `${file.name} ${file.path} ${file.extension} ${file.summary || ''}`
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
    return terms.every((term) => {
      if (/^(cv|resume|résumé)$/.test(term)) return /\b(cv|resume|résumé)\b/.test(haystack);
      return haystack.includes(term);
    });
  }
  return true;
}
export function searchFiles(files: FileItem[], filter: SearchFilter): FileItem[] {
  return files
    .filter((file) => matchesFilter(file, filter))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}
export function dateRange(
  phrase: string,
  now = new Date(),
): Pick<SearchFilter, 'modifiedAfter' | 'modifiedBefore'> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (/last month/i.test(phrase))
    return {
      modifiedAfter: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
      modifiedBefore: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    };
  if (/this month/i.test(phrase))
    return { modifiedAfter: new Date(now.getFullYear(), now.getMonth(), 1).getTime() };
  if (/yesterday/i.test(phrase)) {
    const end = start.getTime();
    start.setDate(start.getDate() - 1);
    return { modifiedAfter: start.getTime(), modifiedBefore: end };
  }
  if (/today/i.test(phrase)) return { modifiedAfter: start.getTime() };
  if (/last week|past week/i.test(phrase)) {
    start.setDate(start.getDate() - 7);
    return { modifiedAfter: start.getTime() };
  }
  const match = phrase.match(/(?:last|past)\s+(\d{1,3})\s+days?/i);
  if (match) {
    start.setDate(start.getDate() - Number(match[1]));
    return { modifiedAfter: start.getTime() };
  }
  return {};
}
