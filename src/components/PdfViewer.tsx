import { useEffect, useRef, useState } from 'react';
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist';
import { LoaderCircle, Minus, Plus, RotateCcw } from 'lucide-react';
import { errorMessage } from '../lib/utils';
import { IconButton } from './ui';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();
export default function PdfViewer({ blob }: { blob: Blob }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(700);
  const scrollRef = useRef<HTMLDivElement>(null);
  const touch = useRef({ distance: 0, zoom: 1 });
  useEffect(() => {
    let active = true;
    let task: ReturnType<typeof getDocument> | undefined;
    blob
      .arrayBuffer()
      .then((data) => {
        if (!active) return;
        task = getDocument({
          data: new Uint8Array(data),
          enableXfa: false,
          useSystemFonts: true,
          stopAtErrors: true,
        });
        task.onPassword = () => {
          setError(
            'This PDF is password-protected. Download it to open with a password-capable app.',
          );
          void task?.destroy();
        };
        return task.promise;
      })
      .then((document) => {
        if (active && document) setPdf(document);
      })
      .catch((error) => {
        if (active) setError(errorMessage(error));
      });
    return () => {
      active = false;
      void task?.destroy();
    };
  }, [blob]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.min(760, entries[0].contentRect.width - 32)),
    );
    observer.observe(element);
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        setZoom((value) => Math.max(0.6, Math.min(3, value - event.deltaY * 0.008)));
      }
    };
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        touch.current = {
          distance: Math.hypot(
            event.touches[0].clientX - event.touches[1].clientX,
            event.touches[0].clientY - event.touches[1].clientY,
          ),
          zoom,
        };
      }
    };
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length === 2 && touch.current.distance) {
        event.preventDefault();
        const distance = Math.hypot(
          event.touches[0].clientX - event.touches[1].clientX,
          event.touches[0].clientY - event.touches[1].clientY,
        );
        setZoom(
          Math.max(0.6, Math.min(3, (touch.current.zoom * distance) / touch.current.distance)),
        );
      }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('touchstart', touchStart, { passive: true });
    element.addEventListener('touchmove', touchMove, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('touchstart', touchStart);
      element.removeEventListener('touchmove', touchMove);
    };
  }, [zoom]);
  return (
    <>
      <div
        className="pdf-scroll"
        ref={scrollRef}
        onDoubleClick={() => setZoom((value) => (value > 1 ? 1 : 1.8))}
      >
        {error ? (
          <div className="viewer-fallback">
            <h3>This PDF needs a different reader.</h3>
            <p>{error}</p>
          </div>
        ) : !pdf ? (
          <div className="viewer-loading">
            <LoaderCircle className="spin" size={28} />
            <span>Preparing your document…</span>
          </div>
        ) : (
          <div className="pdf-pages" style={{ minWidth: width * zoom + 32 }}>
            {Array.from({ length: pdf.numPages }, (_, index) => (
              <PdfPage
                key={index}
                pdf={pdf}
                pageNumber={index + 1}
                width={width * zoom}
                onVisible={setPage}
                scrollRoot={scrollRef}
              />
            ))}
          </div>
        )}
      </div>
      {pdf && (
        <div className="viewer-controls pdf-controls glass">
          <IconButton
            label="Zoom out"
            onClick={() => setZoom((value) => Math.max(0.6, value - 0.2))}
            disabled={zoom <= 0.6}
          >
            <Minus size={17} />
          </IconButton>
          <span>{Math.round(zoom * 100)}%</span>
          <IconButton
            label="Zoom in"
            onClick={() => setZoom((value) => Math.min(3, value + 0.2))}
            disabled={zoom >= 3}
          >
            <Plus size={17} />
          </IconButton>
          <span className="control-divider" />
          <span className="page-count">
            {page}
            <span>/</span>
            {pdf.numPages}
          </span>
          <IconButton label="Reset PDF zoom" onClick={() => setZoom(1)}>
            <RotateCcw size={16} />
          </IconButton>
        </div>
      )}
    </>
  );
}
function PdfPage({
  pdf,
  pageNumber,
  width,
  onVisible,
  scrollRoot,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  onVisible: (page: number) => void;
  scrollRoot: React.RefObject<HTMLDivElement | null>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [ratio, setRatio] = useState(792 / 612);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!wrapper.current) return;
    const loader = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setVisible(entry.isIntersecting);
      },
      { root: scrollRoot.current, rootMargin: '700px 0px' },
    );
    const counter = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) onVisible(pageNumber);
      },
      { root: scrollRoot.current, rootMargin: '-5% 0px -70% 0px', threshold: 0 },
    );
    loader.observe(wrapper.current);
    counter.observe(wrapper.current);
    return () => {
      loader.disconnect();
      counter.disconnect();
    };
  }, [pageNumber, onVisible, scrollRoot]);
  useEffect(() => {
    if (!visible || !canvas.current) return;
    let cancelled = false;
    let render: RenderTask | undefined;
    let page: PDFPageProxy | undefined;
    pdf
      .getPage(pageNumber)
      .then((value) => {
        if (cancelled || !canvas.current) return;
        page = value;
        const natural = value.getViewport({ scale: 1 });
        setRatio(natural.height / natural.width);
        const scale = width / natural.width;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = value.getViewport({ scale: scale * dpr });
        canvas.current.height = Math.ceil(viewport.height);
        canvas.current.width = Math.ceil(viewport.width);
        render = value.render({ canvas: canvas.current, viewport });
        return render.promise;
      })
      .catch((error) => {
        if (!cancelled && error?.name !== 'RenderingCancelledException')
          setError('This page could not be rendered.');
      });
    return () => {
      cancelled = true;
      render?.cancel();
      render?.promise.finally(() => page?.cleanup()).catch(() => undefined);
    };
  }, [pdf, pageNumber, width, visible]);
  return (
    <div
      className="pdf-page"
      ref={wrapper}
      style={{ width, height: width * ratio }}
      aria-label={`Page ${pageNumber}`}
    >
      {error ? (
        <p>{error}</p>
      ) : (
        <canvas
          ref={canvas}
          style={{ width: '100%', height: '100%' }}
          role="img"
          aria-label={`PDF page ${pageNumber}`}
        />
      )}
    </div>
  );
}
