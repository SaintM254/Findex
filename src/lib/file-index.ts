import type { Category, FileItem } from './types';

export interface CategoryTotal {
  category: Category;
  count: number;
  bytes: number;
}
export interface FileIndex {
  byId: Map<string, FileItem>;
  children: Map<string, FileItem[]>;
  bytes: Map<string, number>;
  directFileCount: Map<string, number>;
  categories: CategoryTotal[];
  live: FileItem[];
  trashRoots: FileItem[];
  pinned: FileItem[];
}
const cache = new WeakMap<readonly FileItem[], FileIndex>();
const categories: Category[] = ['images', 'videos', 'audio', 'documents', 'archives', 'other'];

/** Build once per immutable snapshot, not once per file or once per tap. O(n). */
export function indexFiles(files: readonly FileItem[]): FileIndex {
  const cached = cache.get(files);
  if (cached) return cached;
  const byId = new Map(files.map((file) => [file.id, file]));
  const children = new Map<string, FileItem[]>();
  const bytes = new Map<string, number>();
  const directFileCount = new Map<string, number>();
  const totals = new Map(
    categories.map((category) => [category, { category, count: 0, bytes: 0 }]),
  );
  const live: FileItem[] = [];
  const trashRoots: FileItem[] = [];
  const pinned: FileItem[] = [];
  const remaining = new Map<string, number>();
  for (const file of files) {
    if (file.parentId) {
      const siblings = children.get(file.parentId);
      if (siblings) siblings.push(file);
      else children.set(file.parentId, [file]);
    }
    if (file.trashedAt) {
      if (!byId.get(file.parentId || '')?.trashedAt) trashRoots.push(file);
      continue;
    }
    live.push(file);
    bytes.set(file.id, file.kind === 'file' ? file.size : 0);
    if (file.kind === 'folder' && file.pinned) pinned.push(file);
    if (file.parentId && !byId.get(file.parentId)?.trashedAt) {
      remaining.set(file.parentId, (remaining.get(file.parentId) || 0) + 1);
      if (file.kind === 'file')
        directFileCount.set(file.parentId, (directFileCount.get(file.parentId) || 0) + 1);
    }
    if (file.kind === 'file') {
      const total = totals.get(file.category)!;
      total.count++;
      total.bytes += file.size;
    }
  }
  // Bottom-up aggregation visits every edge once. Cycles in a damaged index
  // cannot hang the UI; unresolved cyclic nodes simply do not propagate.
  const queue = live.filter((file) => !remaining.get(file.id)).map((file) => file.id);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    const parent = byId.get(id)?.parentId;
    if (!parent || byId.get(parent)?.trashedAt) continue;
    bytes.set(parent, (bytes.get(parent) || 0) + (bytes.get(id) || 0));
    const rest = (remaining.get(parent) || 1) - 1;
    remaining.set(parent, rest);
    if (rest === 0 && byId.has(parent)) queue.push(parent);
  }
  const result: FileIndex = {
    byId,
    children,
    bytes,
    directFileCount,
    categories: [...totals.values()],
    live,
    trashRoots,
    pinned,
  };
  cache.set(files, result);
  return result;
}
