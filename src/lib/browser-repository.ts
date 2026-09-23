import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  AgentPlan,
  Analysis,
  FileItem,
  OperationRequest,
  Preferences,
  Progress,
  Repository,
  WorkspaceSnapshot,
} from './types';
import {
  categoryFor,
  descendants,
  extension,
  fingerprint,
  folderBytes,
  isDescendant,
  mimeFor,
  pathFor,
  topLevelSelection,
  uniqueName,
  validateName,
} from './utils';
import { cloudSystemPrompt, validateCloudPlan } from './agent';
import { seedWorkspace } from './seed';

interface FindexDB extends DBSchema {
  files: { key: string; value: FileItem };
  blobs: { key: string; value: Blob };
  meta: { key: string; value: unknown };
}
export const defaultPreferences: Preferences = {
  theme: 'system',
  provider: 'openai',
  model: 'gpt-4.1-mini',
  metadataConsent: false,
  hasKey: false,
  showHidden: false,
};

export class BrowserRepository implements Repository {
  native = false;
  private database?: Promise<IDBPDatabase<FindexDB>>;
  private apiKey = '';
  private apiKeyProvider = 'openai';
  private urls = new Map<string, string>();
  private writeQueue: Promise<unknown> = Promise.resolve();
  constructor(private readonly databaseName = 'findex-workspace-v1') {}
  private async withWriteLock<T>(task: () => Promise<T>): Promise<T> {
    if (navigator.locks) return await navigator.locks.request(`${this.databaseName}:write`, task);
    const next = this.writeQueue.then(task, task);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }
  private abort?: AbortController;
  private worker?: Worker;
  private taskId = 0;
  private async db() {
    if (!this.database) this.database = this.initialize();
    return this.database;
  }
  private async initialize() {
    const db = await openDB<FindexDB>(this.databaseName, 1, {
      upgrade(database) {
        database.createObjectStore('files', { keyPath: 'id' });
        database.createObjectStore('blobs');
        database.createObjectStore('meta');
      },
    });
    if (!(await db.get('meta', 'initialized'))) {
      const { files, blobs } = await seedWorkspace();
      const tx = db.transaction(['files', 'blobs', 'meta'], 'readwrite');
      for (const file of files) await tx.objectStore('files').put(file);
      for (const [id, blob] of blobs) await tx.objectStore('blobs').put(blob, id);
      await tx.objectStore('meta').put(true, 'initialized');
      await tx.objectStore('meta').put(defaultPreferences, 'preferences');
      await tx.done;
    }
    return db;
  }
  async load(): Promise<WorkspaceSnapshot> {
    const db = await this.db();
    const stored = await db.getAll('files');
    const files = await Promise.all(
      stored.map(async (file) => {
        if (file.category !== 'images' || file.previewUrl || file.trashedAt) return file;
        if (!this.urls.has(file.id)) {
          const blob = await db.get('blobs', file.id);
          if (blob) this.urls.set(file.id, URL.createObjectURL(blob));
        }
        return { ...file, previewUrl: this.urls.get(file.id) };
      }),
    );
    for (const [id, url] of this.urls)
      if (!files.some((file) => file.id === id && !file.trashedAt)) {
        URL.revokeObjectURL(url);
        this.urls.delete(id);
      }
    const indexed = files
      .filter((file) => file.kind === 'file' && !file.trashedAt)
      .reduce((sum, file) => sum + file.size, 0);
    const used = files
      .filter((file) => file.kind === 'file')
      .reduce((sum, file) => sum + file.size, 0);
    const estimate = (await navigator.storage?.estimate().catch(() => ({}))) as
      { quota?: number } | undefined;
    const total = estimate?.quota || 128 * 1024 * 1024;
    const saved = {
      ...defaultPreferences,
      ...((await db.get('meta', 'preferences')) as Preferences),
    };
    const preferences = {
      ...saved,
      hasKey: Boolean(this.apiKey) && this.apiKeyProvider === saved.provider,
    };
    return {
      files,
      permission: true,
      preferences,
      storage: {
        total,
        used,
        free: Math.max(0, total - used),
        indexed,
        isDemo: true,
        rootId: 'root',
      },
    };
  }
  createFolder(rawName: string, parentId: string): Promise<string> {
    return this.withWriteLock(() => this.createFolderUnlocked(rawName, parentId));
  }
  private async createFolderUnlocked(rawName: string, parentId: string): Promise<string> {
    const db = await this.db();
    const files = await db.getAll('files');
    const name = validateName(rawName);
    this.validateParent(parentId, files);
    if (files.some((file) => file.parentId === parentId && file.name === name && !file.trashedAt))
      throw new Error('An item with this name already exists.');
    const id = crypto.randomUUID();
    await db.put('files', {
      id,
      name,
      path: pathFor(parentId, name, files),
      parentId,
      kind: 'folder',
      category: 'other',
      extension: '',
      mime: 'inode/directory',
      size: 0,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      favorite: false,
      color: 'sage',
    });
    return id;
  }
  private validateParent(parentId: string, files: FileItem[]) {
    if (
      parentId !== 'root' &&
      !files.some((file) => file.id === parentId && file.kind === 'folder' && !file.trashedAt)
    )
      throw new Error('This destination is no longer available.');
  }
  rename(id: string, rawName: string) {
    return this.withWriteLock(() => this.renameUnlocked(id, rawName));
  }
  private async renameUnlocked(id: string, rawName: string) {
    const db = await this.db();
    const files = await db.getAll('files');
    const file = files.find((item) => item.id === id);
    const name = validateName(rawName);
    if (!file || file.trashedAt) throw new Error('This item is no longer available.');
    if (
      files.some(
        (item) =>
          item.id !== id &&
          item.parentId === file.parentId &&
          item.name === name &&
          !item.trashedAt,
      )
    )
      throw new Error('An item with this name already exists.');
    const newPath = pathFor(file.parentId || 'root', name, files);
    const tx = db.transaction('files', 'readwrite');
    for (const child of descendants(id, files))
      await tx.store.put({
        ...child,
        path: newPath + child.path.slice(file.path.length),
        ...(child.id === id
          ? {
              name,
              modifiedAt: Date.now(),
              ...(file.kind === 'file'
                ? { extension: extension(name), category: categoryFor(name, file.mime) }
                : {}),
            }
          : {}),
      });
    await tx.done;
  }
  setFavorite(id: string, favorite: boolean) {
    return this.withWriteLock(async () => {
      const db = await this.db();
      const file = await db.get('files', id);
      if (file)
        await db.put('files', {
          ...file,
          favorite,
          ...(file.kind === 'folder' ? { pinned: favorite } : {}),
        });
    });
  }
  async getBlob(id: string): Promise<Blob> {
    const db = await this.db();
    const blob = await db.get('blobs', id);
    if (!blob) throw new Error('This file cannot be read. It may have been removed.');
    return blob;
  }
  operate(request: OperationRequest, onProgress?: (progress: Progress) => void) {
    return this.withWriteLock(() => this.operateUnlocked(request, onProgress));
  }
  private async operateUnlocked(
    request: OperationRequest,
    onProgress?: (progress: Progress) => void,
  ) {
    const db = await this.db();
    const files = await db.getAll('files');
    const ids = topLevelSelection(request.ids, files);
    const destination = request.destination || 'root';
    if (!ids.length) return;
    if (request.action === 'move' || request.action === 'copy') {
      this.validateParent(destination, files);
      if (ids.some((id) => isDescendant(destination, id, files)))
        throw new Error('A folder cannot be placed inside itself.');
    }
    const targets = ids.map((id) => files.find((file) => file.id === id));
    if (targets.some((file) => !file))
      throw new Error('An item changed since it was selected. Refresh and try again.');
    if (request.action === 'delete' && targets.some((file) => !file!.trashedAt))
      throw new Error('Move files to Trash before permanently deleting them.');
    if (
      ['copy', 'move', 'trash'].includes(request.action) &&
      targets.some((file) => file!.trashedAt)
    )
      throw new Error('Restore these files from Trash first.');
    this.abort = new AbortController();
    const tx = db.transaction(['files', 'blobs'], 'readwrite');
    this.abort.signal.addEventListener(
      'abort',
      () => {
        try {
          tx.abort();
        } catch {
          /* Already committed. */
        }
      },
      { once: true },
    );
    const allNames = new Map<string, string[]>();
    const namesFor = (parent: string) => {
      if (!allNames.has(parent))
        allNames.set(
          parent,
          files
            .filter((file) => file.parentId === parent && !file.trashedAt)
            .map((file) => file.name),
        );
      return allNames.get(parent)!;
    };
    try {
      for (let i = 0; i < targets.length; i++) {
        if (this.abort.signal.aborted)
          throw new Error('Operation cancelled. No changes were saved.');
        const file = targets[i]!;
        const tree = descendants(file.id, files);
        onProgress?.({
          completed: i,
          total: targets.length,
          label: `${request.action === 'copy' ? 'Copying' : request.action === 'move' ? 'Moving' : request.action === 'trash' ? 'Moving to Trash' : request.action === 'restore' ? 'Restoring' : 'Deleting'} ${file.name}`,
          cancellable: true,
        });
        if (request.action === 'delete') {
          for (const item of tree) {
            await tx.objectStore('files').delete(item.id);
            await tx.objectStore('blobs').delete(item.id);
          }
        } else if (request.action === 'trash') {
          for (const item of tree)
            await tx.objectStore('files').put({
              ...item,
              trashedAt: Date.now(),
              originalParentId: item.parentId,
              favorite: false,
            });
        } else {
          let parentId =
            request.action === 'restore' ? file.originalParentId || 'root' : destination;
          if (
            request.action === 'restore' &&
            parentId !== 'root' &&
            !files.some((item) => item.id === parentId && !item.trashedAt)
          )
            parentId = 'root';
          if (request.action === 'move' && parentId === file.parentId) continue;
          const names = namesFor(parentId);
          const name = uniqueName(file.name, names);
          names.push(name);
          const newPath = pathFor(parentId, name, files);
          const idsMap = new Map(
            tree.map((item) => [
              item.id,
              request.action === 'copy' ? crypto.randomUUID() : item.id,
            ]),
          );
          for (const item of tree) {
            const root = item.id === file.id;
            const copy: FileItem = {
              ...item,
              id: idsMap.get(item.id)!,
              parentId: root ? parentId : idsMap.get(item.parentId!)!,
              name: root ? name : item.name,
              path: newPath + item.path.slice(file.path.length),
              trashedAt: undefined,
              originalParentId: undefined,
              ...(request.action === 'copy'
                ? { favorite: false, pinned: false, createdAt: Date.now() }
                : {}),
            };
            await tx.objectStore('files').put(copy);
            if (request.action === 'copy' && item.kind === 'file') {
              const blob = await tx.objectStore('blobs').get(item.id);
              if (blob) await tx.objectStore('blobs').put(blob, copy.id);
            }
          }
        }
      }
      await tx.done;
      onProgress?.({ completed: targets.length, total: targets.length, label: 'All done' });
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* The transaction may already be rolled back. */
      }
      await tx.done.catch(() => undefined);
      if (this.abort.signal.aborted) throw new Error('Operation cancelled. No changes were saved.');
      throw error;
    } finally {
      this.abort = undefined;
    }
  }
  importFiles(incoming: File[], parentId: string, onProgress?: (progress: Progress) => void) {
    return this.withWriteLock(() => this.importFilesUnlocked(incoming, parentId, onProgress));
  }
  private async importFilesUnlocked(
    incoming: File[],
    parentId: string,
    onProgress?: (progress: Progress) => void,
  ) {
    const db = await this.db();
    const current = await db.getAll('files');
    this.validateParent(parentId, current);
    const existing = current
      .filter((file) => file.parentId === parentId && !file.trashedAt)
      .map((file) => file.name);
    for (let i = 0; i < incoming.length; i++) {
      const source = incoming[i];
      const name = uniqueName(validateName(source.name), existing);
      existing.push(name);
      onProgress?.({ completed: i, total: incoming.length, label: `Importing ${name}` });
      const id = crypto.randomUUID();
      const mime = source.type || mimeFor(name);
      const summary = /^(txt|md|csv|json)$/.test(extension(name))
        ? (await source.slice(0, 8192).text()).slice(0, 4000)
        : undefined;
      // Hash in the Web Crypto worker pool, with a size guard to avoid huge allocations.
      const hash = source.size <= 128 * 1024 * 1024 ? await fingerprint(source) : undefined;
      const file: FileItem = {
        id,
        name,
        parentId,
        path: pathFor(parentId, name, current),
        kind: 'file',
        category: categoryFor(name, mime),
        extension: extension(name),
        mime,
        size: source.size,
        createdAt: Date.now(),
        modifiedAt: source.lastModified || Date.now(),
        favorite: false,
        summary,
        fingerprint: hash,
      };
      const tx = db.transaction(['files', 'blobs'], 'readwrite');
      await tx.objectStore('files').put(file);
      await tx.objectStore('blobs').put(source, id);
      await tx.done;
    }
    onProgress?.({ completed: incoming.length, total: incoming.length, label: 'Files imported' });
  }
  async savePreferences(preferences: Preferences, apiKey?: string) {
    if (apiKey !== undefined) {
      this.apiKey = apiKey.trim();
      this.apiKeyProvider = preferences.provider;
    }
    const db = await this.db();
    await db.put('meta', { ...preferences, hasKey: false }, 'preferences');
  }
  async requestPermission() {
    /* Browser storage is sandboxed; Android implements the system permission flow. */
  }
  async reindex(onProgress?: (progress: Progress) => void) {
    const db = await this.db();
    const files = await db.getAll('files');
    onProgress?.({ completed: 0, total: files.length, label: 'Refreshing your local index' });
    const previous: Record<string, number> = {};
    for (const file of files.filter((item) => item.kind === 'folder' && item.parentId === 'root'))
      previous[file.id] = folderBytes(file.id, files);
    await db.put('meta', previous, 'previousSnapshot');
    onProgress?.({
      completed: files.length,
      total: files.length,
      label: 'Your index is up to date',
    });
  }
  async analyze(): Promise<Analysis> {
    const db = await this.db();
    const files = await db.getAll('files');
    const previous = await db.get('meta', 'previousSnapshot');
    if (!this.worker)
      this.worker = new Worker(new URL('./indexer.worker.ts', import.meta.url), { type: 'module' });
    const worker = this.worker;
    const id = ++this.taskId;
    worker.postMessage({ id: 0, type: 'index', files });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.removeEventListener('message', listener);
        reject(new Error('The scan took too long. Please try again.'));
      }, 30_000);
      const listener = (event: MessageEvent) => {
        if (event.data.id === id) {
          clearTimeout(timeout);
          worker.removeEventListener('message', listener);
          resolve(event.data.result as Analysis);
        }
      };
      worker.addEventListener('message', listener);
      worker.postMessage({ id, type: 'analyze', previous });
    });
  }
  async askAgent(prompt: string, files: FileItem[]): Promise<AgentPlan> {
    const { preferences } = await this.load();
    if (!preferences.metadataConsent || !preferences.hasKey)
      throw new Error(
        'Connect a provider and allow metadata sharing in Settings first. Local tools work without an API key.',
      );
    const context = JSON.stringify({
      now: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      query: prompt,
      files: files
        .filter((file) => !file.trashedAt)
        .slice(0, 500)
        .map(({ id, name, parentId, kind, category, size, modifiedAt }) => ({
          id,
          name,
          parentId,
          kind,
          category,
          size,
          modifiedAt,
        })),
    });
    const model = preferences.model;
    let url: string;
    let body: unknown;
    let headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (preferences.provider === 'openai') {
      url = 'https://api.openai.com/v1/chat/completions';
      headers.Authorization = `Bearer ${this.apiKey}`;
      body = {
        model,
        messages: [
          { role: 'system', content: cloudSystemPrompt },
          { role: 'user', content: context },
        ],
        response_format: { type: 'json_object' },
      };
    } else if (preferences.provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      headers = {
        ...headers,
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
      body = {
        model,
        max_tokens: 1000,
        system: cloudSystemPrompt,
        messages: [{ role: 'user', content: context }],
      };
    } else {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      headers['x-goog-api-key'] = this.apiKey;
      body = {
        systemInstruction: { parts: [{ text: cloudSystemPrompt }] },
        contents: [{ parts: [{ text: context }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 2048 },
      };
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    }).catch(() => {
      throw new Error(
        'Could not reach your AI provider. Check your connection or use the local tools below.',
      );
    });
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'Your API key was not accepted. Check it in Settings.'
          : `Your provider returned an error (${response.status}). No files were changed.`,
      );
    const data = await response.json();
    const text =
      preferences.provider === 'openai'
        ? data.choices?.[0]?.message?.content
        : preferences.provider === 'anthropic'
          ? data.content?.find((part: { type: string }) => part.type === 'text')?.text
          : data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string')
      throw new Error('The provider returned an empty response. No files were changed.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      throw new Error('The provider returned an unreadable plan. No files were changed.');
    }
    return validateCloudPlan(parsed, files);
  }
  async openNative() {
    throw new Error('Native viewers are available in the Android app.');
  }
  async cancelOperation() {
    this.abort?.abort();
  }
}
