'use client';
import { useCallback, useEffect, useRef } from 'react';

export interface LightboxItem {
  id: string;
  url?: string;
  filename?: string;
  caption?: string | null;
  mime_type?: string;
}

interface LightboxProps {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}

export default function Lightbox({ items, index, onClose, onIndexChange }: LightboxProps) {
  const total = items.length;
  const item = items[index];
  const touchStartX = useRef<number | null>(null);

  const go = useCallback(
    (delta: number) => {
      if (total < 2) return;
      onIndexChange((index + delta + total) % total);
    },
    [index, total, onIndexChange]
  );

  // Keyboard: ← previous, → next, Esc close.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        go(-1);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        go(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [go, onClose]);

  // Keep the page behind the viewer from scrolling.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!item) return null;
  const caption = item.caption?.trim() || item.filename || 'Untitled moment';

  return (
    <div
      className="lightbox-backdrop fixed inset-0 z-[70] flex flex-col bg-black/90 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      onClick={onClose}
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        if (touchStartX.current == null) return;
        const delta = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
        touchStartX.current = null;
        if (Math.abs(delta) > 50) go(delta > 0 ? -1 : 1);
      }}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 text-white sm:px-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[.22em] text-white/55">
            {total > 1 ? `${index + 1} / ${total}` : 'Photo'}
          </p>
          <p className="truncate text-sm font-medium text-white/90">{caption}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white/85 transition hover:bg-white/10 sm:block"
            >
              Open original ↗
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close photo viewer"
            className="grid h-10 w-10 place-items-center rounded-full border border-white/20 text-lg text-white transition hover:bg-white/15"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Stage */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-3 pb-2 sm:px-20">
        {total > 1 && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              go(-1);
            }}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/40 text-2xl leading-none text-white transition hover:bg-white/20 sm:left-6 sm:h-12 sm:w-12"
          >
            ‹
          </button>
        )}

        <figure
          className="flex h-full w-full items-center justify-center"
          onClick={(event) => event.stopPropagation()}
        >
          <img
            key={item.id}
            src={item.url}
            alt={caption}
            className="lightbox-image max-h-[72vh] w-auto max-w-full rounded-xl object-contain shadow-2xl sm:max-h-[76vh]"
          />
        </figure>

        {total > 1 && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              go(1);
            }}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/40 text-2xl leading-none text-white transition hover:bg-white/20 sm:right-6 sm:h-12 sm:w-12"
          >
            ›
          </button>
        )}
      </div>

      {/* Bottom hint */}
      <div
        className="px-6 pb-5 pt-1 text-center text-[11px] text-white/50"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="hidden sm:inline">
          {total > 1 ? '← → to browse · Esc to close' : 'Esc to close'}
        </span>
        <span className="sm:hidden">Swipe to browse · Tap outside to close</span>
      </div>
    </div>
  );
}
