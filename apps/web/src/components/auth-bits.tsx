"use client";

import { useEffect, useState } from "react";
import { Field } from "@/components/ui";

export function PasswordField({ id, label, value, onChange, error, hint, autoComplete, aside }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string; autoComplete: string; aside?: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      {aside && <div style={{ position: "absolute", right: 0, top: 0 }}>{aside}</div>}
      <Field id={id} label={label} error={error} hint={hint}>
        {(a) => (
          <div className="pw-wrap">
            <input {...a} type={show ? "text" : "password"} className="input lg" value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} />
            <button type="button" className="pw-toggle" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
          </div>
        )}
      </Field>
    </div>
  );
}

export const passwordRule = (pw: string) => (!pw ? "Create a password." : pw.length < 8 ? "Use at least 8 characters." : !/\d/.test(pw) || !/[a-z]/i.test(pw) ? "Include at least one letter and one number." : "");

/** Starts Google sign-in on this site (Supabase OAuth with PKCE, returning to /auth/callback). */
export function GoogleButton({ label = "Continue with Google" }: { label?: string }) {
  return (
    <a href="/api/auth/google" className="btn lg block" style={{ textDecoration: "none", justifyContent: "center" }}>
      <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.6 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
        <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z" />
      </svg>
      {label}
    </a>
  );
}

const CALLBACK_MESSAGES: Record<string, { tone: "err" | "ok"; text: string }> = {
  "error=provider": { tone: "err", text: "Google sign-in was cancelled or failed. Try again." },
  "error=expired": { tone: "err", text: "That sign-in link has expired or was opened in a different browser. Sign in again." },
  "notice=confirmed": { tone: "ok", text: "Your email is confirmed. Sign in to continue." },
};

/** Explains why /auth/callback sent the visitor here (from the query string). */
export function useCallbackNotice() {
  const [notice, setNotice] = useState<{ tone: "err" | "ok"; text: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const key = q.get("error") ? `error=${q.get("error")}` : q.get("notice") ? `notice=${q.get("notice")}` : "";
    setNotice(CALLBACK_MESSAGES[key] ?? null);
  }, []);
  return notice;
}
