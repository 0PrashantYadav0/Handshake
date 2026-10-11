"use client";
// Recovery codes, shown once after enrollment or regeneration (trust spec §4).
import { CopyButton } from "@/components/ShareLink";

export function RecoveryCodes({ codes }: { codes: string[] }) {
  const text = codes.join("\n");
  const href = `data:text/plain;charset=utf-8,${encodeURIComponent(`Handshake recovery codes\nEach code works once.\n\n${text}\n`)}`;
  return (
    <section className="hs-card" aria-labelledby="rc-h">
      <h2 id="rc-h" className="font-semibold">Your recovery codes</h2>
      <p className="hs-help mt-1">Save these somewhere safe. Each one signs you in once if you lose your phone. They won&apos;t be shown again.</p>
      <ol className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm" data-testid="recovery-codes">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ol>
      <div className="mt-3 flex gap-2">
        <CopyButton text={text} label="Copy codes" className="hs-btn-secondary" />
        <a className="hs-btn-secondary" href={href} download="handshake-recovery-codes.txt">Download</a>
      </div>
    </section>
  );
}
