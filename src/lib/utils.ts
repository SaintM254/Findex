import { indexFiles } from './file-index';
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
  openai: 'gpt-5-mini',
  anthropic: 'claude-haiku-4-5',
  gemini: 'gemini-2.5-flash',
} as const;
// Providers retire model IDs; saved preferences may still name one that now
// answers 404. Map known-retired defaults onto their current replacements.
const RETIRED_MODELS: Record<string, string> = {
  'gpt-4.1-mini': 'gpt-5-mini',
  'gpt-4o-mini': 'gpt-5-mini',
  'claude-sonnet-4-20250514': 'claude-haiku-4-5',
  'claude-3-5-haiku-20241022': 'claude-haiku-4-5',
  'claude-3-haiku-20240307': 'claude-haiku-4-5',
  'gemini-1.5-flash': 'gemini-2.5-flash',
  'gemini-2.0-flash': 'gemini-2.5-flash',
};
export function resolveModel(model: string): string {
  return RETIRED_MODELS[model] ?? model;
}
export function formatDuration(value?: number): string {
  if (!value || !Number.isFinite(value) || value <= 0) return '';
  const total = Math.round(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (part: number) => String(part).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
export function probeAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    if (typeof Audio === 'undefined') return reject(new Error('Audio is unavailable here.'));
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const timer = setTimeout(fail, 8000);
    function done(value: number) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    }
    function fail() {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(new Error('Audio metadata could not be read.'));
    }
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () =>
      Number.isFinite(audio.duration) && audio.duration > 0 ? done(audio.duration) : fail(),
    );
    audio.addEventListener('error', fail);
    audio.src = url;
  });
}
export function selectionRange(order: string[], anchor: string, target: string): string[] {
  const start = order.indexOf(anchor);
  const end = order.indexOf(target);
  if (start === -1 || end === -1) return [target];
  const [lo, hi] = start < end ? [start, end] : [end, start];
  return order.slice(lo, hi + 1);
}
export function extension(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}
export function categoryFor(name: string, mime = ''): Category {
  const ext = extension(name);
  if (mime.startsWith('image/') || /^(jpg|jpeg|png|webp|gif|heic|avif|bmp|svg)$/.test(ext))
    return 'images';
  if (mime.startsWith('video/') || /^(mp4|mkv|mov|webm|avi|m4v)$/.test(ext)) return 'videos';
  if (
    mime.startsWith('audio/') ||
    /^(mp3|wav|aac|flac|ogg|m4a|opus|amr|awb|aiff|mka|wma)$/.test(ext)
  )
    return 'audio';
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
  const { byId } = indexFiles(files);
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
  const { byId, children } = indexFiles(files);
  const result: FileItem[] = [];
  const queue = [id];
  const seen = new Set<string>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (seen.has(current)) continue;
    seen.add(current);
    const item = byId.get(current);
    if (item) result.push(item);
    for (const child of children.get(current) || []) queue.push(child.id);
  }
  return result;
}
export function topLevelSelection(ids: string[], files: FileItem[]): string[] {
  const selected = new Set(ids);
  const { byId } = indexFiles(files);
  return [...selected].filter((id) => {
    let parent = byId.get(id)?.parentId;
    const visited = new Set<string>([id]);
    while (parent && !visited.has(parent)) {
      if (selected.has(parent)) return false;
      visited.add(parent);
      parent = byId.get(parent)?.parentId;
    }
    return true;
  });
}
export function pathFor(parentId: string, name: string, files: FileItem[]): string {
  const parent = files.find((file) => file.id === parentId);
  return `${parent?.path || ''}/${name}`;
}
export function folderBytes(folderId: string, files: FileItem[]): number {
  return indexFiles(files).bytes.get(folderId) || 0;
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
