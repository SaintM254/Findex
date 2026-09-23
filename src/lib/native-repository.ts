import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type {
  AgentPlan,
  Analysis,
  FileItem,
  FilePage,
  FileQuery,
  OperationResult,
  OperationRequest,
  Preferences,
  Progress,
  Repository,
  WorkspaceSnapshot,
} from './types';
import { cloudSystemPrompt, validateCloudPlan } from './agent';
import { BrowserRepository } from './browser-repository';

interface FindexPlugin {
  load(): Promise<WorkspaceSnapshot>;
  listFiles(query: FileQuery): Promise<FilePage>;
  inspectFiles(options: { ids: string[]; details?: boolean }): Promise<{ files: FileItem[] }>;
  planningContext(): Promise<{ files: FileItem[] }>;
  ensureFolderPath(options: { path: string; parentId: string }): Promise<{ id: string }>;
  requestPermission(): Promise<void>;
  createFolder(options: { name: string; parentId: string }): Promise<{ id: string }>;
  rename(options: { id: string; name: string }): Promise<void>;
  setFavorite(options: { id: string; favorite: boolean }): Promise<void>;
  operate(options: OperationRequest): Promise<OperationResult>;
  pickFiles(options: { parentId: string }): Promise<void>;
  readFile(options: { id: string }): Promise<{ uri: string }>;
  openFile(options: { id: string }): Promise<void>;
  savePreferences(options: { preferences: Preferences; apiKey?: string }): Promise<void>;
  reindex(): Promise<void>;
  analyze(): Promise<Analysis>;
  askAgent(options: {
    prompt: string;
    system: string;
    timezone: string;
  }): Promise<{ plan: unknown }>;
  cancelOperation(): Promise<void>;
  exitApp(): Promise<void>;
  addListener(
    event: 'progress' | 'indexUpdated' | 'insets' | 'directoryChanged',
    callback: (data: Progress & { top?: number; bottom?: number; path?: string }) => void,
  ): Promise<PluginListenerHandle>;
}
export const FindexNative = registerPlugin<FindexPlugin>('Findex');
class NativeRepository implements Repository {
  native = true;
  private thumbnails(files: FileItem[]) {
    return files.map((file) =>
      file.category === 'images' && !file.trashedAt && file.previewUrl
        ? { ...file, previewUrl: Capacitor.convertFileSrc(file.previewUrl) }
        : file,
    );
  }
  async load() {
    const snapshot = await FindexNative.load();
    snapshot.files = this.thumbnails(snapshot.files);
    return snapshot;
  }
  async listFiles(query: FileQuery) {
    const result = await FindexNative.listFiles(query);
    return { ...result, files: this.thumbnails(result.files) };
  }
  async inspectFiles(ids: string[], details = false) {
    return this.thumbnails((await FindexNative.inspectFiles({ ids, details })).files);
  }
  async planningContext() {
    return (await FindexNative.planningContext()).files;
  }
  async ensureFolderPath(path: string, parentId: string) {
    return (await FindexNative.ensureFolderPath({ path, parentId })).id;
  }
  requestPermission() {
    return FindexNative.requestPermission();
  }
  async createFolder(name: string, parentId: string) {
    return (await FindexNative.createFolder({ name, parentId })).id;
  }
  rename(id: string, name: string) {
    return FindexNative.rename({ id, name });
  }
  setFavorite(id: string, favorite: boolean) {
    return FindexNative.setFavorite({ id, favorite });
  }
  async operate(request: OperationRequest, onProgress?: (progress: Progress) => void) {
    const listener = await FindexNative.addListener('progress', (progress) =>
      onProgress?.(progress),
    );
    try {
      return await FindexNative.operate(request);
    } finally {
      await listener.remove();
    }
  }
  async importFiles(_files: File[], parentId: string, onProgress?: (progress: Progress) => void) {
    const listener = await FindexNative.addListener('progress', (progress) =>
      onProgress?.(progress),
    );
    try {
      await FindexNative.pickFiles({ parentId });
    } finally {
      await listener.remove();
    }
  }
  async getBlob(id: string) {
    const { uri } = await FindexNative.readFile({ id });
    const response = await fetch(Capacitor.convertFileSrc(uri));
    if (!response.ok) throw new Error('Could not read this file.');
    return response.blob();
  }
  savePreferences(preferences: Preferences, apiKey?: string) {
    return FindexNative.savePreferences({ preferences, apiKey });
  }
  async reindex(onProgress?: (progress: Progress) => void) {
    const listener = await FindexNative.addListener('progress', (progress) =>
      onProgress?.(progress),
    );
    try {
      await FindexNative.reindex();
    } finally {
      await listener.remove();
    }
  }
  analyze() {
    return FindexNative.analyze();
  }
  async askAgent(prompt: string, files: FileItem[]): Promise<AgentPlan> {
    const { plan } = await FindexNative.askAgent({
      prompt,
      system: cloudSystemPrompt,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    return validateCloudPlan(plan, files);
  }
  openNative(file: FileItem) {
    return FindexNative.openFile({ id: file.id });
  }
  cancelOperation() {
    return FindexNative.cancelOperation();
  }
}
export const repository: Repository = Capacitor.isNativePlatform()
  ? new NativeRepository()
  : new BrowserRepository();
