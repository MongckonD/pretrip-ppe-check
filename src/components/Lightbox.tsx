/**
 * Full-screen photo viewer: tap a thumbnail to open, ← / → (or the side buttons, or a swipe) to move,
 * Esc / ✕ / tap outside to close. "เปิดในแท็บใหม่" opens the original file.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface LightboxPhoto { url: string; caption: string }

export function Lightbox({ photos, start, onClose }: { photos: LightboxPhoto[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const n = photos.length;
  const prev = () => setI((x) => (x - 1 + n) % n);
  const next = () => setI((x) => (x + 1) % n);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  const p = photos[i];
  if (!p) return null;
  // rendered on <body> so no card / panel around it can clip or shift the full-screen overlay
  return createPortal(
    <div className="lb" role="dialog" aria-modal="true" aria-label={p.caption} onClick={onClose}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - (touchX.current ?? e.changedTouches[0].clientX);
        if (Math.abs(dx) > 50) { if (dx > 0) prev(); else next(); }
        touchX.current = null;
      }}>
      <div className="lb-top" onClick={(e) => e.stopPropagation()}>
        <span>{p.caption}{n > 1 && <span className="lb-count"> · {i + 1}/{n}</span>}</span>
        <span className="row">
          <a className="lb-btn" href={p.url} target="_blank" rel="noopener noreferrer">เปิดในแท็บใหม่</a>
          <button type="button" className="lb-btn" onClick={onClose} aria-label="ปิด">✕</button>
        </span>
      </div>
      <img className="lb-img" src={p.url} alt={p.caption} onClick={(e) => e.stopPropagation()} />
      {n > 1 && (
        <>
          <button type="button" className="lb-nav prev" aria-label="รูปก่อนหน้า" onClick={(e) => { e.stopPropagation(); prev(); }}>‹</button>
          <button type="button" className="lb-nav next" aria-label="รูปถัดไป" onClick={(e) => { e.stopPropagation(); next(); }}>›</button>
        </>
      )}
    </div>,
    document.body,
  );
}
