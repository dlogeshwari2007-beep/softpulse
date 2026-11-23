import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Activity, ArrowRight, Check, Code2, Eye, EyeOff, LockKeyhole, Mail, Moon, ShieldCheck, Sun } from "lucide-react";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

type Mode = "signin" | "signup" | "reset";

export default function App() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dark, setDark] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSessionEmail(data.session?.user.email ?? null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSessionEmail(session?.user.email ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!email.trim() || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (mode !== "reset" && password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (!supabase) {
      setError("Supabase is not configured yet. Add your project URL and anon key to .env.local.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        setMessage("Account created. Check your inbox to confirm your email, then sign in.");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin
        });
        if (error) throw error;
        setMessage("Password reset link sent. Check your inbox.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
    setMessage("You have signed out.");
  };

  return (
    <main className="auth-shell">
      <section className="visual-panel" aria-label="SoftPulse product overview">
        <div className="visual-grid" />
        <div className="brand brand-light">
          <span className="brand-mark"><Activity size={19} /></span><span>softpulse</span>
        </div>
        <div className="visual-copy">
          <div className="eyebrow"><span className="pulse-dot" /> SOFTWARE HEALTH INTELLIGENCE</div>
          <h1>Build with confidence.<br /><span>Maintain with clarity.</span></h1>
          <p>One clear view of code quality, maintainability and the work that matters next.</p>
          <div className="preview-card">
            <div className="preview-top"><span>Repository health</span><span className="live-label"><i /> READY</span></div>
            <div className="preview-score-row">
              <div className="score-ring"><div><strong>87</strong><small>/100</small></div></div>
              <div className="score-copy"><strong>Healthy codebase</strong><span>Grade A <b>↑ 4.2%</b></span><small>Compared with your last assessment</small></div>
            </div>
            <div className="preview-bars">
              <div><span>Maintainability</span><i><b style={{ width: "91%" }} /></i><strong>91</strong></div>
              <div><span>Test coverage</span><i><b style={{ width: "78%" }} /></i><strong>78</strong></div>
              <div><span>Code quality</span><i><b style={{ width: "84%" }} /></i><strong>84</strong></div>
            </div>
            <div className="preview-foot"><span><Code2 size={14} /> commons-utils</span><span>Last scan · 8 min ago</span></div>
          </div>
        </div>
        <div className="visual-footer"><span>Clarity for every commit.</span><span>© 2026 SoftPulse</span></div>
      </section>

      <section className="form-panel">
        <header className="form-header">
          <div className="brand brand-dark"><span className="brand-mark"><Activity size={18} /></span><span>softpulse</span></div>
          <button className="theme-toggle" onClick={() => setDark(v => !v)} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </header>
        <div className="form-wrap">
          {sessionEmail ? (
            <div className="signed-in">
              <div className="success-icon"><Check size={25} /></div>
              <div className="eyebrow muted">SESSION ACTIVE</div>
              <h2>You're signed in.</h2>
              <p className="subcopy">Authenticated as <strong>{sessionEmail}</strong>.</p>
              <button className="primary-button" onClick={signOut}>Sign out <ArrowRight size={17} /></button>
            </div>
          ) : (
            <>
              <div className="form-heading">
                <div className="eyebrow muted">{mode === "signup" ? "GET STARTED" : mode === "reset" ? "ACCOUNT RECOVERY" : "WELCOME BACK"}</div>
                <h2>{mode === "signup" ? "Create your account" : mode === "reset" ? "Reset your password" : "Sign in to SoftPulse"}</h2>
                <p className="subcopy">{mode === "signup" ? "Start making software health visible." : mode === "reset" ? "We'll email you a secure reset link." : "Your codebase health, all in one place."}</p>
              </div>

              {!isSupabaseConfigured && (
                <div className="config-note"><ShieldCheck size={17} /><span><strong>Demo setup</strong><br />Connect Supabase in <code>.env.local</code> to enable authentication.</span></div>
              )}

              <form onSubmit={submit} noValidate>
                <label htmlFor="email">Email address</label>
                <div className="input-wrap"><Mail size={17} /><input id="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} /></div>
                {mode !== "reset" && <>
                  <div className="label-row">
                    <label htmlFor="password">Password</label>
                    {mode === "signin" && <button type="button" className="text-button" onClick={() => { setMode("reset"); setError(""); setMessage(""); }}>Forgot password?</button>}
                  </div>
                  <div className="input-wrap">
                    <LockKeyhole size={17} />
                    <input id="password" type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder="At least 8 characters" value={password} onChange={e => setPassword(e.target.value)} />
                    <button type="button" className="eye-button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                  </div>
                </>}
                {error && <div className="form-alert error" role="alert">{error}</div>}
                {message && <div className="form-alert success" role="status">{message}</div>}
                <button className="primary-button" type="submit" disabled={busy}>
                  {busy ? "Please wait…" : mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"} <ArrowRight size={17} />
                </button>
              </form>

              <div className="form-switch">
                {mode === "signup" ? "Already have an account?" : mode === "reset" ? "Remembered your password?" : "New to SoftPulse?"}
                <button className="text-button strong" onClick={() => { setMode(mode === "signup" || mode === "reset" ? "signin" : "signup"); setError(""); setMessage(""); }}>
                  {mode === "signup" || mode === "reset" ? "Sign in" : "Create an account"}
                </button>
              </div>
              <div className="security-note"><ShieldCheck size={15} /> Your workspace is protected with role-based access.</div>
            </>
          )}
        </div>
        <footer className="form-footer"><span>Privacy</span><span>Security</span><span>Help centre</span><span className="version">SOFTPULSE 0.1.0</span></footer>
      </section>
    </main>
  );
}
