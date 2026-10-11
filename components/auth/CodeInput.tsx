"use client";
// The 6-digit code field shared by sign-in, setup and every step-up prompt (trust spec §4).
export function CodeInput({ id, value, onChange, label = "6-digit code" }: { id: string; value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <>
      <label htmlFor={id} className="hs-label">{label}</label>
      <input
        id={id} name={id} className="hs-input w-40 font-mono text-lg tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code"
        pattern="\d{6}" maxLength={6} required value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
    </>
  );
}

/** Error text for the code screens: the server message is specific (lockout, already used), so prefer it. */
export function codeError(e: unknown): string {
  const m = e instanceof Error && "code" in e ? e.message : "";
  return m && m !== "network" ? m : "Something went wrong. Try again.";
}
