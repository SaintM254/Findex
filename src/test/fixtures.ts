import type { FileItem } from '../lib/types';
export const now = new Date('2026-09-22T12:00:00Z');
export function file(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: 'file-1',
    name: 'Notes.txt',
    path: '/Downloads/Notes.txt',
    parentId: 'downloads',
    kind: 'file',
    category: 'documents',
    extension: 'txt',
    mime: 'text/plain',
    size: 12,
    createdAt: now.getTime() - 86400_000,
    modifiedAt: now.getTime(),
    favorite: false,
    ...overrides,
  };
}
export function folder(overrides: Partial<FileItem> = {}): FileItem {
  return file({
    id: 'downloads',
    name: 'Downloads',
    path: '/Downloads',
    parentId: 'root',
    kind: 'folder',
    category: 'other',
    extension: '',
    mime: 'inode/directory',
    size: 0,
    ...overrides,
  });
}
