"use client";
// Photo lightbox (08 sections 4.6, 11): a native <dialog> with Close, Previous/Next, arrow keys, Escape and a backdrop click.
// `useLightbox(photos)` gives a component its `open(i)` and the element to render; `Thumb` is the labelled button that opens it.
import { useEffect, useRef, useState, type ReactNode } from "react";

export type Photo = { src: string; alt: string; label?: string };

export function useLightbox(photos: Photo[]): { open: (i: number) => void; lightbox: ReactNode } {
  const [index, setIndex] = useState<number | null>(null);
  return { open: setIndex, lightbox: <Lightbox photos={photos} index={index} onChange={setIndex} /> };
}

export function Thumb({ photo, onClick, onError, className = "" }: { photo: Photo; onClick: () => void; onError?: () => void; className?: string }) {
  return (
    <button type="button" className={`hs-thumb ${className}`} onClick={onClick} aria-label={`${photo.alt}. Open full size`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- blob: and signed URLs */}
      <img src={photo.src} alt={photo.alt} onError={onError} />
      {photo.label && <span className="hs-thumb-label" aria-hidden>{photo.label}</span>}
    </button>
  );
}

function Lightbox({ photos, index, onChange }: { photos: Photo[]; index: number | null; onChange: (i: number | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (index !== null && !d.open) d.showModal();
    if (index === null && d.open) d.close();
  }, [index]);

  const n = photos.length;
  const p = index === null ? null : photos[index];
  const go = (delta: number) => index !== null && n > 1 && onChange((index + delta + n) % n);
  return (
    <dialog
      ref={ref}
      className="hs-lightbox"
      aria-label={p ? `${p.alt}, ${(index ?? 0) + 1} of ${n}` : "Photo"}
      data-testid="lightbox"
      onClose={() => onChange(null)}
      onClick={(e) => e.target === e.currentTarget && onChange(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
      }}
    >
      {p && (
        <figure onClick={(e) => e.target === e.currentTarget && onChange(null)}>
          <div className="absolute right-3 top-3 z-10">
            <button type="button" className="hs-lightbox-btn" aria-label="Close" onClick={() => onChange(null)}>
              <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M4 4l8 8M12 4l-8 8" /></svg>
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- blob: and signed URLs */}
          <img src={p.src} alt={p.alt} />
          <figcaption className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span>{p.label && <span className="font-mono">{p.label} · </span>}{p.alt}{n > 1 && <span className="text-white/70"> · {(index ?? 0) + 1} of {n}</span>}</span>
            {n > 1 && (
              <span className="flex gap-2">
                <button type="button" className="hs-lightbox-btn" aria-label="Previous photo" onClick={() => go(-1)}>
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10 3L5 8l5 5" /></svg>
                </button>
                <button type="button" className="hs-lightbox-btn" aria-label="Next photo" onClick={() => go(1)}>
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 3l5 5-5 5" /></svg>
                </button>
              </span>
            )}
          </figcaption>
        </figure>
      )}
    </dialog>
  );
}
