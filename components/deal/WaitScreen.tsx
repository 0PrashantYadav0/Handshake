"use client";
// The verdict wait screen (08 section 7.8): three steps with a ring on the active one and a check when done, elapsed seconds,
// the conditions with pulsing dots (static under reduced motion, CSS). The list is the aria-live region; step changes are announced.
import { useEffect, useState } from "react";
import type { Condition } from "@/lib/deal/types";
import { Ring } from "@/components/Ring";

type Props = { conditions: Condition[]; uploaded: boolean; progress: string | null; lost: boolean };

export function WaitScreen({ conditions, uploaded, progress, lost }: Props) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (lost) {
    return (
      <div role="alert" className="grid gap-3">
        <p className="text-sm">
          We lost the connection while checking. Reload to see the result. If the check could not finish, Handshake re-runs it within 10 minutes; nothing is charged until then.
        </p>
        <button type="button" className="hs-btn justify-self-start" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
  const steps: [string, boolean, boolean][] = [
    ["Photos uploaded", uploaded, !uploaded],
    ["Comparing photos with the terms", false, uploaded],
    ["Applying the rule", false, false],
  ];
  return (
    <div className="grid gap-4" data-testid="wait-screen">
      <ol className="grid gap-2 text-sm" aria-live="polite">
        {steps.map(([label, done, active]) => (
          <li key={label} className="flex items-center gap-2" data-state={done ? "done" : active ? "active" : "todo"}>
            {done ? <span className="hs-verdict" data-result="pass" aria-hidden>✓</span> : active ? <Ring /> : <span className="hs-dot" aria-hidden />}
            <span className={active ? "font-medium" : done ? "" : "text-[var(--hs-muted)]"}>
              {label}{done && <span className="sr-only"> (done)</span>}{active && <span className="sr-only"> (in progress)</span>}
            </span>
            {active && <span className="hs-help tabular-nums">{uploaded ? `${sec} s` : progress}</span>}
          </li>
        ))}
      </ol>
      <ul className="grid gap-1 text-sm">
        {conditions.map((c) => (
          <li key={c.id} className="flex items-center gap-2"><span className="hs-dot" data-active={uploaded} aria-hidden /> {c.text}</li>
        ))}
      </ul>
      <p className="hs-help">Usually under 15 seconds, at most about 40. Keep this page open. Nothing moves until this finishes.</p>
    </div>
  );
}
