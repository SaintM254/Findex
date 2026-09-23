import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { repository, FindexNative } from './native-repository';
import { defaultPreferences } from './browser-repository';
import { errorMessage } from './utils';
import type { FileItem, Preferences, Progress, StorageInfo } from './types';

interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'error' | 'info';
  action?: { label: string; run: () => void };
}
interface Workspace {
  files: FileItem[];
  storage: StorageInfo;
  preferences: Preferences;
  permission: boolean;
  loading: boolean;
  error: string | null;
  progress: Progress | null;
  toast: Toast | null;
  refresh: () => Promise<void>;
  run: (
    label: string,
    task: (onProgress: (progress: Progress) => void) => Promise<unknown>,
    success?: string,
  ) => Promise<boolean>;
  notify: (message: string, tone?: Toast['tone'], action?: Toast['action']) => void;
  clearToast: () => void;
}
const initialStorage: StorageInfo = {
  used: 0,
  total: 0,
  free: 0,
  indexed: 0,
  isDemo: true,
  rootId: 'root',
};
const WorkspaceContext = createContext<Workspace | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [storage, setStorage] = useState<StorageInfo>(initialStorage);
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [permission, setPermission] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = useRef(false);
  const notify = useCallback(
    (message: string, tone: Toast['tone'] = 'success', action?: Toast['action']) => {
      clearTimeout(toastTimer.current);
      setToast({ id: Date.now(), message, tone, action });
      toastTimer.current = setTimeout(() => setToast(null), action ? 9000 : 5000);
    },
    [],
  );
  const refresh = useCallback(async () => {
    const snapshot = await repository.load();
    setFiles(snapshot.files);
    setStorage(snapshot.storage);
    setPreferences(snapshot.preferences);
    setPermission(snapshot.permission);
    setError(null);
  }, []);
  useEffect(() => {
    refresh()
      .catch((error) => setError(errorMessage(error)))
      .finally(() => setLoading(false));
    return () => clearTimeout(toastTimer.current);
  }, [refresh]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark =
        preferences.theme === 'dark' || (preferences.theme === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#171e19' : '#f4f6f1');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preferences.theme]);
  useEffect(() => {
    if (!repository.native) return;
    const updates = FindexNative.addListener('indexUpdated', () => {
      refresh().catch(() => undefined);
    });
    const insets = FindexNative.addListener('insets', (data) => {
      document.documentElement.style.setProperty('--native-safe-top', `${data.top || 0}px`);
      document.documentElement.style.setProperty('--native-safe-bottom', `${data.bottom || 0}px`);
    });
    const resume = () => {
      if (document.visibilityState === 'visible') refresh().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', resume);
    return () => {
      updates.then((handle) => handle.remove());
      insets.then((handle) => handle.remove());
      document.removeEventListener('visibilitychange', resume);
    };
  }, [refresh]);
  const run = useCallback(
    async (
      label: string,
      task: (onProgress: (progress: Progress) => void) => Promise<unknown>,
      success?: string,
    ) => {
      if (busy.current) {
        notify('An operation is already in progress. Give it a moment.', 'info');
        return false;
      }
      busy.current = true;
      setProgress({ completed: 0, total: 0, label });
      try {
        await task(setProgress);
        await refresh();
        if (success) notify(success);
        return true;
      } catch (error) {
        notify(errorMessage(error), 'error');
        await refresh().catch(() => undefined);
        return false;
      } finally {
        busy.current = false;
        setProgress(null);
      }
    },
    [notify, refresh],
  );
  return (
    <WorkspaceContext.Provider
      value={{
        files,
        storage,
        preferences,
        permission,
        loading,
        error,
        progress,
        toast,
        refresh,
        run,
        notify,
        clearToast: () => setToast(null),
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('WorkspaceProvider is missing.');
  return context;
}
