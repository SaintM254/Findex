import type { Category, FileItem } from './types';

export const CATEGORY_LABELS: Record<Category, string> = {
  images: 'Images',
  videos: 'Videos',
  audio: 'Audio',
  documents: 'Documents',
  archives: 'Archives',
  other: 'Other',
};
export const CATEGORY_ORDER: Category[] = [
  'images',
  'videos',
  'audio',
  'documents',
  'archives',
  'other',
];
export const DEFAULT_MODELS = {
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.5-flash',
};
export function extension(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}
export function categoryFor(name: string, mime = ''): Category {
  const ext = extension(name);
  if (mime.startsWith('image/') || /^(jpg|jpeg|png|webp|gif|heic|avif|bmp|svg)$/.test(ext))
    return 'images';
  if (mime.startsWith('video/') || /^(mp4|mkv|mov|webm|avi|m4v)$/.test(ext)) return 'videos';
  if (mime.startsWith('audio/') || /^(mp3|wav|aac|flac|ogg|m4a|opus)$/.test(ext)) return 'audio';
  if (/^(pdf|doc|docx|txt|md|rtf|xls|xlsx|csv|ppt|pptx|json|html)$/.test(ext)) return 'documents';
  if (/^(zip|rar|7z|tar|gz|bz2)$/.test(ext)) return 'archives';
  return 'other';
}
export function mimeFor(name: string): string {
  const mimes: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    gif: 'image/gif',
    mp4: 'video/mp4',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    zip: 'application/zip',
  };
  return mimes[extension(name)] || 'application/octet-stream';
}
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${parseFloat((bytes / 1024 ** i).toFixed(i === 0 ? 0 : decimals))} ${['B', 'KB', 'MB', 'GB', 'TB'][i]}`;
}
export function relativeDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}
export function validateName(name: string): string {
  const clean = name.trim();
  if (!clean || clean === '.' || clean === '..') throw new Error('Please enter a valid name.');
  if (/[\\/\u0000-\u001f]/.test(clean))
    throw new Error('Names cannot contain slashes or control characters.');
  if (new TextEncoder().encode(clean).length > 240)
    throw new Error('This name is too long. Try something shorter.');
  if (clean === '.findex-trash' || clean === '.findex-staging')
    throw new Error('This name is reserved for Findex.');
  return clean;
}
export function uniqueName(name: string, existing: string[]): string {
  if (!existing.includes(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const suffix = dot > 0 ? name.slice(dot) : '';
  let n = 1;
  while (existing.includes(`${stem} (${n})${suffix}`)) n++;
  return `${stem} (${n})${suffix}`;
}
export function isDescendant(id: string, possibleAncestor: string, files: FileItem[]): boolean {
  const byId = new Map(files.map((file) => [file.id, file]));
  const seen = new Set<string>();
  let current: string | null | undefined = id;
  while (current && !seen.has(current)) {
    if (current === possibleAncestor) return true;
    seen.add(current);
    current = byId.get(current)?.parentId;
  }
  return false;
}
export function descendants(id: string, files: FileItem[]): FileItem[] {
  return files.filter((file) => isDescendant(file.id, id, files));
}
export function topLevelSelection(ids: string[], files: FileItem[]): string[] {
  const selected = new Set(ids);
  return ids.filter(
    (id) =>
      !files.some(
        (file) => file.id !== id && selected.has(file.id) && isDescendant(id, file.id, files),
      ),
  );
}
export function pathFor(parentId: string, name: string, files: FileItem[]): string {
  const parent = files.find((file) => file.id === parentId);
  return `${parent?.path || ''}/${name}`;
}
export function folderBytes(folderId: string, files: FileItem[]): number {
  return descendants(folderId, files)
    .filter((file) => file.kind === 'file' && !file.trashedAt)
    .reduce((sum, file) => sum + file.size, 0);
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export async function fingerprint(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
