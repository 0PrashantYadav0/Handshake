// Indeterminate progress ring (08 sections 4.6, 7.8): an arc that spins; static under prefers-reduced-motion (CSS). Decorative; the text next to it carries the meaning.
export function Ring({ className = "" }: { className?: string }) {
  return (
    <svg className={`hs-ring ${className}`} viewBox="0 0 20 20" aria-hidden>
      <circle className="track" cx="10" cy="10" r="8" />
      <circle className="arc" cx="10" cy="10" r="8" />
    </svg>
  );
}
