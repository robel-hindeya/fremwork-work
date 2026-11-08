"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** Email links land here with the session in the URL hash, which only the browser can read. */
export default function AuthCallback() {
  const [error, setError] = useState("");

  useEffect(() => {
    window.history.replaceState(null, '', '/auth/callback');
    setError('This sign-in link is no longer supported. Please sign in again.');
  }, []);

  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 16, textAlign: "center" }}>
      {error ? <div><p>{error}</p><Link href="/sign-in" className="btn primary">Back to sign in</Link></div> : <p className="muted">Signing you in…</p>}
    </div>
  );
}
