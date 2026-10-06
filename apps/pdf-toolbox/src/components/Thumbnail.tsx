import { FileWarning } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { viewSize } from '../core/geometry';
import { effectiveRotation, type WorkspacePage } from '../core/types';
import { thumbnailUrl } from '../state/thumbnails';
import { AnnotationShapes } from './AnnotationShapes';

interface Props {
  page: WorkspacePage;
  /** CSS width of the thumbnail box. */
  width: number;
  showAnnotations?: boolean;
}

/** Page thumbnail rendered lazily when it scrolls into view. */
export function Thumbnail({ page, width, showAnnotations = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<{ key: string; url: string | null; error: boolean }>({
    key: '',
    url: null,
    error: false,
  });
  const rotation = effectiveRotation(page);
  const size = viewSize(page.size.width, page.size.height, rotation);
  const height = Math.round((width * size.height) / size.width);
  const pixelWidth = Math.min(600, Math.round(width * Math.min(2, window.devicePixelRatio || 1)));
  const key = `${page.sourceId}:${page.sourceIndex}:${rotation}:${pixelWidth}`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || state.key === key) return;
    let cancelled = false;
    thumbnailUrl(page.sourceId, page.sourceIndex, rotation, pixelWidth, 1)
      .then((url) => !cancelled && setState({ key, url, error: false }))
      .catch(() => !cancelled && setState({ key, url: null, error: true }));
    return () => {
      cancelled = true;
    };
  }, [visible, key, state.key, page.sourceId, page.sourceIndex, rotation, pixelWidth]);

  const ready = state.key === key && state.url;
  return (
    <div className="thumb" ref={ref} style={{ width, height }}>
      {ready ? (
        <img src={state.url!} alt="" draggable={false} />
      ) : state.error ? (
        <FileWarning className="thumb__error" aria-label="Page could not be rendered" />
      ) : (
        <div className="thumb__placeholder" />
      )}
      {showAnnotations && page.annotations.length > 0 && (
        <svg
          className="thumb__overlay"
          viewBox={`0 0 ${size.width} ${size.height}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          <AnnotationShapes page={page} />
        </svg>
      )}
    </div>
  );
}
