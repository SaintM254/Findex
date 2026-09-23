import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import type { FilePage, FileQuery } from './types';
import { FindexNative, repository } from './native-repository';
import { errorMessage } from './utils';

const emptyPage: FilePage = { files: [], ancestors: [], total: 0, page: 0, pageSize: 80 };

/** Folder navigation is independent of boot/index progress and never loads the full library. */
export function useNativeListing(query: FileQuery, enabled: boolean, revision: number) {
  const [result, setResult] = useState<FilePage>(emptyPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  const key = JSON.stringify(query);
  const reload = useCallback(
    async (clear = false) => {
      if (!enabled || !repository.listFiles) return;
      const token = ++generation.current;
      setLoading(true);
      setError('');
      if (clear) setResult(emptyPage);
      try {
        const next = await repository.listFiles(queryRef.current);
        if (token === generation.current) startTransition(() => setResult(next));
      } catch (error) {
        if (token === generation.current) setError(errorMessage(error));
      } finally {
        if (token === generation.current) setLoading(false);
      }
    },
    [enabled],
  );
  const previousKey = useRef('');
  useEffect(() => {
    if (!enabled) return;
    const changed = previousKey.current !== key;
    previousKey.current = key;
    const timer = setTimeout(
      () => {
        void reload(changed);
      },
      queryRef.current.section === 'search' && changed ? 140 : 0,
    );
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [key, enabled, revision, reload]);
  useEffect(() => {
    if (!enabled || !repository.native) return;
    const changes = FindexNative.addListener('directoryChanged', () => {
      if (queryRef.current.section === 'all' || queryRef.current.section === 'folder')
        void reload();
    });
    return () => {
      void changes.then((listener) => listener.remove());
    };
  }, [enabled, reload]);
  return { ...result, loading, error, reload };
}
