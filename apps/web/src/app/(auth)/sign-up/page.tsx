"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { GoogleButton, PasswordField, passwordRule } from "@/components/auth-bits";
import { Banner, Field, FieldError } from "@/components/ui";
import { isEmail } from "@/lib/format";
import { api } from "@/lib/client/api";
import { useData } from "@/lib/client/store";

/** Seconds between confirmation emails; Supabase rejects faster repeats. */
const RESEND_WAIT = 60;

export default function SignUp() {
  const router = useRouter();
  const { refresh } = useData();
  const [v, setV] = useState({ name: "", email: "", company: "", pw: "" });
  const [terms, setTerms] = useState(false);
  const [tried, setTried] = useState(false);
  const [apiError, setApiError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [resendNote, setResendNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const e = {
    name: !v.name.trim() ? "Enter your name." : "",
    email: !v.email.trim() ? "Enter your work email." : !isEmail(v.email) ? "Enter a valid email, like name@company.com." : "",
    company: !v.company.trim() ? "Enter your company’s name." : "",
    pw: passwordRule(v.pw),
    terms: !terms ? "Accept the terms to create your account." : "",
  };
  const bad = Object.values(e).filter(Boolean).length;
  const set = (k: keyof typeof v) => (x: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: x.target.value });
  const err = (k: keyof typeof e) => (tried ? e[k] || undefined : undefined);

  const submit = async (x: React.FormEvent) => {
    x.preventDefault();
    if (bad) return setTried(true);
    setBusy(true);
    setApiError("");

    try {
      const res = await api.post<{ needsConfirmation?: boolean }>("/api/auth/sign-up", {
        name: v.name.trim(),
        email: v.email.trim(),
        company: v.company.trim(),
        password: v.pw,
      });
      if (res.needsConfirmation) {
        setCooldown(RESEND_WAIT);
        return setConfirm(true);
      }
      await refresh();
      router.push("/chat");
    } catch (err: any) {
      setApiError(err.message || "Failed to create account");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setResending(true);
    setResendNote(null);
    try {
      await api.post("/api/auth/resend", { email: v.email.trim() });
      setResendNote({ tone: "ok", text: "Email sent. It can take a few minutes to arrive." });
      setCooldown(RESEND_WAIT);
    } catch (x: any) {
      setResendNote({ tone: "err", text: x.message || "We couldn't resend the email. Try again." });
    } finally {
      setResending(false);
    }
  };

  if (confirm) {
    return (
      <div className="auth-form">
        <span className="ic-box" style={{ width: 48, height: 48, borderRadius: "50%" }}><Mail size={22} /></span>
        <div><h1>Check your email</h1><p className="muted" style={{ margin: "6px 0 0" }}>We sent a confirmation link to <b style={{ color: "var(--ink)" }}>{v.email.trim()}</b>. Open it to finish creating your account.</p></div>
        {resendNote && <Banner tone={resendNote.tone}>{resendNote.text}</Banner>}
        <p className="muted" style={{ margin: 0 }}>It can take a few minutes to arrive. If you can’t find it, check your spam folder.</p>
        <button type="button" className="btn lg block" onClick={resend} disabled={resending || cooldown > 0}>{resending ? "Sending…" : cooldown > 0 ? `Resend email in ${cooldown}s` : "Resend email"}</button>
        <p className="muted" style={{ margin: 0, textAlign: "center" }}>Already confirmed? <Link href="/sign-in" style={{ fontWeight: 500, textDecoration: "none" }}>Sign in</Link></p>
      </div>
    );
  }

  return (
    <form className="auth-form" noValidate onSubmit={submit}>
      <div><h1>Create your account</h1><p className="muted" style={{ margin: "6px 0 0" }}>Start with your company’s numbers. It takes about two minutes.</p></div>
      {apiError && <Banner tone="err">{apiError}</Banner>}
      {tried && bad > 0 && <Banner tone="err">{bad === 1 ? "Fix 1 field to continue." : `Fix ${bad} fields to continue.`}</Banner>}
      <GoogleButton label="Sign up with Google" />
      <div className="divider">or with email</div>
      <Field id="su-name" label="Full name" error={err("name")}>{(a) => <input {...a} className="input lg" autoComplete="name" value={v.name} onChange={set("name")} />}</Field>
      <Field id="su-email" label="Work email" error={err("email")}>{(a) => <input {...a} type="email" className="input lg" autoComplete="email" placeholder="name@company.com" value={v.email} onChange={set("email")} />}</Field>
      <Field id="su-company" label="Company name" error={err("company")}>{(a) => <input {...a} className="input lg" autoComplete="organization" value={v.company} onChange={set("company")} />}</Field>
      <PasswordField id="su-pw" label="Password" value={v.pw} onChange={(p) => setV({ ...v, pw: p })} error={err("pw")} hint="At least 8 characters, with a letter and a number." autoComplete="new-password" />
      <div className="field">
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontWeight: 400, cursor: "pointer" }}>
          <input type="checkbox" checked={terms} onChange={(x) => setTerms(x.target.checked)} aria-invalid={!!err("terms")} style={{ marginTop: 2, width: 16, height: 16, accentColor: "#0A0A0A" }} />
          I agree to the Terms of Service and Privacy Policy.
        </label>
        {err("terms") && <FieldError>{err("terms")}</FieldError>}
      </div>
      <button type="submit" className="btn primary lg block" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
      <p className="muted" style={{ margin: 0, textAlign: "center" }}>Already have an account? <Link href="/sign-in" style={{ fontWeight: 500, textDecoration: "none" }}>Sign in</Link></p>
    </form>
  );
}
