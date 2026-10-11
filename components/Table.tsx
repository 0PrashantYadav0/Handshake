// The plain table of /dashboard and /wallet (trust spec §10; 08 section 11): a caption, scope=col headers, sideways scroll on phones.
import { when } from "@/lib/ledger-columns";

export type Row = { key: string; cells: React.ReactNode[] };

export function Table({ caption, head, rows, empty, id }: { caption: string; head: string[]; rows: Row[]; empty: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="overflow-x-auto rounded-[var(--hs-radius)] border border-[var(--hs-border)] bg-[var(--hs-surface)] shadow-[var(--hs-shadow)]">
      <table className={`w-full text-left text-sm ${rows.length ? "min-w-[44rem]" : ""}`}>
        <caption className="px-4 pt-4 pb-2 text-left text-base font-semibold md:px-5">{caption}</caption>
        {rows.length > 0 && (
          <thead className="text-xs text-[var(--hs-muted)]">
            <tr className="border-b border-[var(--hs-border)]">
              {head.map((h) => <th key={h} scope="col" className="px-4 py-2 font-medium first:md:pl-5">{h}</th>)}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.length ? rows.map((r) => (
            <tr key={r.key} className="border-b border-[var(--hs-border)] align-top last:border-0">
              {r.cells.map((c, i) => <td key={i} className="px-4 py-3 first:md:pl-5">{c}</td>)}
            </tr>
          )) : (
            <tr><td className="px-4 pb-4 text-[var(--hs-muted)] md:px-5">{empty}</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

/** 08 section 2: local time, the ISO string in title. */
export const Time = ({ iso }: { iso: string | null }) => (iso ? <time dateTime={iso} title={iso}>{when(iso)}</time> : <>—</>);

/** A PayPal id in monospace, never split mid-id; the table scrolls sideways instead. */
export const Id = ({ v }: { v: string | null }) => (v ? <code className="font-mono text-xs whitespace-nowrap">{v}</code> : <>—</>);
