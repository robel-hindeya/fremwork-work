"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GoogleButton, PasswordField, useCallbackNotice } from "@/components/auth-bits";
import { Banner, Field } from "@/components/ui";
import { isEmail } from "@/lib/format";
import { api } from "@/lib/client/api";
import { useData } from "@/lib/client/store";

export default function SignIn() {
  const router = useRouter();
  const { refresh } = useData();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [tried, setTried] = useState(false);
  const [fails, setFails] = useState(0);
  const [wrong, setWrong] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const notice = useCallbackNotice();
  const locked = fails >= 3;
  const e = { email: !email.trim() ? "Enter your work email." : !isEmail(email) ? "Enter a valid email, like name@company.com." : "", pw: !pw ? "Enter your password." : "" };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (locked) return;
    if (e.email || e.pw) return setTried(true);
    setBusy(true);
    setErrorMsg("");

    try {
      await api.post("/api/auth/sign-in", { email, password: pw });
      await refresh();
      router.push("/chat");
    } catch (err: any) {
      setFails((f) => f + 1);
      setWrong(true);
      setErrorMsg(err.message || "That email and password don’t match.");
      setTried(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div><h1>Welcome back</h1><p className="muted" style={{ margin: "6px 0 0" }}>Sign in to Fremwork.</p></div>
      {locked ? <Banner tone="err" title="Too many attempts."><Link href="/forgot-password">Reset your password</Link>, or reload the page to try again.</Banner>
        : wrong ? <Banner tone="err" title={errorMsg || "That email and password don’t match."}>Try again. {3 - fails} {3 - fails === 1 ? "try" : "tries"} left before sign-in pauses.</Banner>
        : notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}
      <GoogleButton />
      <div className="divider">or with email</div>
      <Field id="si-email" label="Work email" error={tried ? e.email || undefined : undefined}>{(a) => <input {...a} type="email" className="input lg" autoComplete="email" placeholder="name@company.com" value={email} onChange={(x) => { setEmail(x.target.value); setWrong(false); }} />}</Field>
      <PasswordField id="si-pw" label="Password" value={pw} onChange={(v) => { setPw(v); setWrong(false); }} error={tried ? e.pw || undefined : undefined} autoComplete="current-password" aside={<Link href="/forgot-password" style={{ fontSize: 13, fontWeight: 500, textDecoration: "none" }}>Forgot password?</Link>} />
      <button type="submit" className="btn primary lg block" disabled={locked || busy}>{locked ? "Sign-in paused" : busy ? "Signing in…" : "Sign in"}</button>
      <p className="muted" style={{ margin: 0, textAlign: "center" }}>New to Fremwork? <Link href="/sign-up" style={{ fontWeight: 500, textDecoration: "none" }}>Create an account</Link></p>
    </form>
  );
}
