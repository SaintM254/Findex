import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  AudioLines,
  ChevronLeft,
  ChevronRight,
  Download,
  Expand,
  FileQuestion,
  LoaderCircle,
  Minus,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
import type { FileItem } from '../lib/types';
import { repository } from '../lib/native-repository';
import { useWorkspace } from '../lib/workspace';
import { downloadBlob, errorMessage, formatBytes } from '../lib/utils';
import { IconButton, Modal } from './ui';

const PdfViewer = lazy(() => import('./PdfViewer'));
export function Viewer({
  file,
  onClose,
  onNavigate,
  canPrevious,
  canNext,
}: {
  file: FileItem;
  onClose: () => void;
  onNavigate: (direction: number) => void;
  canPrevious: boolean;
  canNext: boolean;
}) {
  const { notify } = useWorkspace();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [mediaError, setMediaError] = useState(false);
  const [loading, setLoading] = useState(true);
  const textFile = /^(txt|md|csv|json|log|xml|yaml|yml|css|js|ts)$/.test(file.extension);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setLoading(true);
    setError('');
    setMediaError(false);
    setBlob(null);
    setText('');
    setUrl('');
    repository
      .getBlob(file.id)
      .then(async (value) => {
        if (!active) return;
        setBlob(value);
        objectUrl = URL.createObjectURL(value);
        setUrl(objectUrl);
        if (textFile) {
          const content = await value.slice(0, 2 * 1024 * 1024).text();
          if (active) setText(content);
        }
      })
      .catch((error) => {
        if (active) setError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, textFile]);
  const download = () => {
    if (blob) {
      downloadBlob(blob, file.name);
      notify('Your file is ready to download.');
    }
  };
  return (
    <Modal
      label={`Preview ${file.name}`}
      onClose={onClose}
      className={`viewer-modal ${file.category === 'images' || file.category === 'videos' ? 'media-viewer' : ''}`}
    >
      <div className="viewer-header">
        <IconButton label="Close viewer" onClick={onClose}>
          <X size={21} />
        </IconButton>
        <div className="viewer-file-title">
          <strong>{file.name}</strong>
          <span>
            {file.extension.toUpperCase()}
            <span>·</span>
            {formatBytes(file.size)}
          </span>
        </div>
        <div className="viewer-navigation">
          <IconButton label="Previous file" disabled={!canPrevious} onClick={() => onNavigate(-1)}>
            <ChevronLeft size={20} />
          </IconButton>
          <IconButton label="Next file" disabled={!canNext} onClick={() => onNavigate(1)}>
            <ChevronRight size={20} />
          </IconButton>
        </div>
        <IconButton label="Download file" onClick={download} disabled={!blob}>
          <Download size={20} />
        </IconButton>
      </div>
      <div
        className={`viewer-stage ${file.extension === 'pdf' ? 'pdf-stage' : ''} ${textFile ? 'text-stage' : ''}`}
      >
        {loading ? (
          <div className="viewer-loading">
            <LoaderCircle size={30} className="spin" />
            <span>Opening a little something…</span>
          </div>
        ) : error ? (
          <div className="viewer-fallback">
            <FileQuestion size={44} />
            <h3>This file needs a moment.</h3>
            <p>{error}</p>
          </div>
        ) : file.extension === 'pdf' && blob ? (
          <Suspense
            fallback={
              <div className="viewer-loading">
                <LoaderCircle size={30} className="spin" />
                <span>Getting the pages ready…</span>
              </div>
            }
          >
            <PdfViewer blob={blob} />
          </Suspense>
        ) : file.category === 'images' && !mediaError ? (
          <ImageViewer
            key={file.id}
            url={url}
            name={file.name}
            onError={() => setMediaError(true)}
          />
        ) : file.category === 'videos' && !mediaError ? (
          <div className="video-stage">
            <video
              key={file.id}
              src={url}
              controls
              playsInline
              preload="metadata"
              onError={() => setMediaError(true)}
              aria-label={file.name}
            />
            <p>Make yourself comfortable.</p>
          </div>
        ) : file.category === 'audio' && !mediaError ? (
          <div className="audio-stage">
            <div className="audio-art">
              <div className="audio-record">
                <AudioLines size={54} strokeWidth={1.1} />
              </div>
              <span className="audio-art-wordmark">findex sessions</span>
            </div>
            <h2>{file.name.replace(/\.[^.]+$/, '')}</h2>
            <span className="audio-subtitle">A moment, just for listening.</span>
            <audio
              key={file.id}
              src={url}
              controls
              preload="metadata"
              onError={() => setMediaError(true)}
              aria-label={file.name}
            />
          </div>
        ) : textFile ? (
          <div className="text-document">
            <div className="document-eyebrow">{file.extension.toUpperCase()} DOCUMENT</div>
            <pre>{text}</pre>
            {file.size > 2 * 1024 * 1024 && (
              <p className="settings-fineprint">
                Showing the first 2 MB. Download for the complete file.
              </p>
            )}
          </div>
        ) : (
          <div className="viewer-fallback">
            <FileQuestion size={45} strokeWidth={1.3} />
            <h3>A job for another app.</h3>
            <p>
              {mediaError
                ? 'This browser cannot decode this media format.'
                : 'This file type does not have a built-in preview.'}
              <br />
              Download it to open in your preferred application.
            </p>
            <button className="primary-button" onClick={download}>
              <Download size={17} />
              Download file
            </button>
            <small>The Android app opens the native “Open with” dialog.</small>
          </div>
        )}
      </div>
    </Modal>
  );
}
function ImageViewer({ url, name, onError }: { url: string; name: string; onError: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const points = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef({ distance: 0, zoom: 1 });
  const container = useRef<HTMLDivElement>(null);
  const setScale = (value: number) => {
    const next = Math.max(1, Math.min(6, value));
    setZoom(next);
    if (next === 1) setPan({ x: 0, y: 0 });
  };
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((value) => {
        const next = Math.max(1, Math.min(6, value - event.deltaY * 0.003));
        if (next === 1) setPan({ x: 0, y: 0 });
        return next;
      });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  function down(event: PointerEvent) {
    if ((event.target as HTMLElement).closest('button')) return;
    container.current?.setPointerCapture(event.pointerId);
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.current.size === 2) {
      const [a, b] = [...points.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }
  function move(event: PointerEvent) {
    const previous = points.current.get(event.pointerId);
    if (!previous) return;
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.current.size === 2) {
      const [a, b] = [...points.current.values()];
      if (pinch.current.distance)
        setScale((pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.distance);
    } else if (zoom > 1)
      setPan((value) => ({
        x: value.x + event.clientX - previous.x,
        y: value.y + event.clientY - previous.y,
      }));
  }
  return (
    <div
      className={`image-stage ${zoom > 1 ? 'zoomed' : ''}`}
      ref={container}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={(event) => points.current.delete(event.pointerId)}
      onPointerCancel={(event) => points.current.delete(event.pointerId)}
      onDoubleClick={() => setScale(zoom > 1 ? 1 : 2.2)}
    >
      <img
        src={url}
        alt={name}
        onError={onError}
        draggable={false}
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      />
      <div className="viewer-controls glass" onPointerDown={(event) => event.stopPropagation()}>
        <IconButton label="Zoom out" onClick={() => setScale(zoom - 0.25)} disabled={zoom <= 1}>
          <Minus size={18} />
        </IconButton>
        <span>{Math.round(zoom * 100)}%</span>
        <IconButton label="Zoom in" onClick={() => setScale(zoom + 0.25)} disabled={zoom >= 6}>
          <Plus size={18} />
        </IconButton>
        <span className="control-divider" />
        <IconButton
          label="Reset image view"
          onClick={() => {
            setScale(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          <RotateCcw size={17} />
        </IconButton>
        <IconButton
          label="View fullscreen"
          onClick={() => {
            container.current?.requestFullscreen?.().catch(() => undefined);
          }}
        >
          <Expand size={17} />
        </IconButton>
      </div>
    </div>
  );
}
