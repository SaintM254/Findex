export type Category = 'images' | 'videos' | 'audio' | 'documents' | 'archives' | 'other';
export type FileKind = 'file' | 'folder';
export type FolderColor = 'sage' | 'sand' | 'lavender' | 'blue';
export interface FileItem {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  kind: FileKind;
  category: Category;
  extension: string;
  mime: string;
  size: number;
  createdAt: number;
  modifiedAt: number;
  favorite: boolean;
  pinned?: boolean;
  color?: FolderColor;
  trashedAt?: number;
  originalParentId?: string | null;
  previewUrl?: string;
  summary?: string;
  fingerprint?: string;
  width?: number;
  height?: number;
  duration?: number;
}
export interface StorageInfo {
  total: number;
  used: number;
  free: number;
  indexed: number;
  isDemo: boolean;
  rootId: string;
}
export interface Progress {
  id?: string;
  completed: number;
  total: number;
  label: string;
  bytes?: number;
  cancellable?: boolean;
}
export type FileOperation = 'copy' | 'move' | 'trash' | 'restore' | 'delete';
export interface OperationRequest {
  action: FileOperation;
  ids: string[];
  destination?: string;
}
export interface Clipboard {
  action: 'copy' | 'move';
  ids: string[];
}
export type Page =
  'overview' | 'all' | 'recent' | 'favorites' | 'trash' | 'folder' | 'category' | 'search';
export interface Location {
  page: Page;
  id?: string;
  title?: string;
}
export type Theme = 'light' | 'dark' | 'system';
export type Provider = 'openai' | 'anthropic' | 'gemini';
export interface Preferences {
  theme: Theme;
  provider: Provider;
  model: string;
  metadataConsent: boolean;
  hasKey: boolean;
  showHidden: boolean;
}
export interface SearchFilter {
  text?: string;
  category?: Category;
  extension?: string;
  modifiedAfter?: number;
  modifiedBefore?: number;
  nameIncludes?: string;
  parentId?: string;
  minSize?: number;
}
export interface AgentPlan {
  kind: 'search' | 'organize' | 'analyze' | 'cleanup' | 'move';
  title: string;
  explanation: string;
  filter?: SearchFilter;
  sourceFolder?: string;
  destination?: string;
}
export interface PlannedMove {
  id: string;
  destination: string;
}
export interface Analysis {
  totalBytes: number;
  totalFiles: number;
  largeFiles: FileItem[];
  duplicates: FileItem[][];
  cleanup: FileItem[];
  emptyFolders: FileItem[];
  growth: { name: string; bytes: number; previousBytes: number | null }[];
}
export interface WorkspaceSnapshot {
  files: FileItem[];
  storage: StorageInfo;
  permission: boolean;
  preferences: Preferences;
}
export interface Repository {
  native: boolean;
  load(): Promise<WorkspaceSnapshot>;
  createFolder(name: string, parentId: string): Promise<string>;
  rename(id: string, name: string): Promise<void>;
  setFavorite(id: string, favorite: boolean): Promise<void>;
  operate(request: OperationRequest, onProgress?: (progress: Progress) => void): Promise<void>;
  importFiles(
    files: File[],
    parentId: string,
    onProgress?: (progress: Progress) => void,
  ): Promise<void>;
  getBlob(id: string): Promise<Blob>;
  savePreferences(preferences: Preferences, apiKey?: string): Promise<void>;
  requestPermission(): Promise<void>;
  reindex(onProgress?: (progress: Progress) => void): Promise<void>;
  analyze(): Promise<Analysis>;
  askAgent(prompt: string, files: FileItem[]): Promise<AgentPlan>;
  openNative(file: FileItem): Promise<void>;
  cancelOperation(): Promise<void>;
}
