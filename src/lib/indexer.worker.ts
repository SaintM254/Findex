/// <reference lib="webworker" />
import { searchFiles } from './search';
import { analyzeFiles } from './agent';
import type { FileItem, SearchFilter } from './types';

let index: FileItem[] = [];
self.onmessage = (
  event: MessageEvent<{
    id: number;
    type: string;
    files?: FileItem[];
    filter?: SearchFilter;
    previous?: Record<string, number>;
  }>,
) => {
  const { id, type, files, filter, previous } = event.data;
  if (type === 'index') {
    index = files || [];
    self.postMessage({ id, result: index.length });
  }
  if (type === 'search')
    self.postMessage({ id, result: searchFiles(index, filter || {}).map((file) => file.id) });
  if (type === 'analyze') self.postMessage({ id, result: analyzeFiles(index, previous) });
};
