"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Bean, TrendingUp, Shield, Smartphone, ArrowRight, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    const supabase = createClient();

    if (mode === "signup") {
      if (password !== confirmPassword) {
        setError("Passwords don't match.");
        setLoading(false);
        return;
      }
      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        setLoading(false);
        return;
      }
      const { error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) {
        setError(authError.message);
        setLoading(false);
      } else {
        setSuccess("Check your email for a confirmation link!");
        setLoading(false);
      }
    } else {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError("Invalid email or password.");
        setLoading(false);
      } else {
        router.push("/");
        router.refresh();
      }
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    setError("");
    const supabase = createClient();
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}${basePath}/` },
    });
    if (error) {
      setError(error.message);
      setGoogleLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a12] flex flex-col">
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Left — hero */}
        <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 lg:px-20 py-12 lg:py-0">
          <div className="flex items-center gap-3 mb-10">
            <div className="p-2.5 bg-accent rounded-xl shadow-lg shadow-accent/20">
              <Bean className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-white tracking-tight">BeanCount</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-6">
            Every bean,
            <br />
            <span className="bg-linear-to-r from-accent via-purple-400 to-pink-400 bg-clip-text text-transparent">
              accounted for.
            </span>
          </h1>
          <p className="text-lg text-white/50 max-w-md mb-12 leading-relaxed">
            Track bank accounts, investments, crypto, credit cards, and debts — all counted in real-time.
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
              <div className="p-2 bg-green-500/15 rounded-lg">
                <TrendingUp className="w-4 h-4 text-green-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Real-time sync</p>
                <p className="text-xs text-white/40">Plaid &amp; Teller integrations</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
              <div className="p-2 bg-blue-500/15 rounded-lg">
                <Shield className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Bank-grade security</p>
                <p className="text-xs text-white/40">End-to-end encryption</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
              <div className="p-2 bg-purple-500/15 rounded-lg">
                <Smartphone className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Works everywhere</p>
                <p className="text-xs text-white/40">Web &amp; mobile apps</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right — auth form */}
        <div className="flex-1 flex items-center justify-center px-6 py-12 lg:py-0 lg:bg-white/2 lg:border-l lg:border-white/5">
          <div className="w-full max-w-sm">
            {/* Tab toggle */}
            <div className="flex bg-white/5 rounded-xl p-1 mb-8">
              <button
                type="button"
                onClick={() => { setMode("login"); setError(""); setSuccess(""); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  mode === "login" ? "bg-accent text-white shadow-sm" : "text-white/50 hover:text-white/70"
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => { setMode("signup"); setError(""); setSuccess(""); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  mode === "signup" ? "bg-accent text-white shadow-sm" : "text-white/50 hover:text-white/70"
                }`}
              >
                Create account
              </button>
            </div>

            {/* Google */}
            <button
              type="button"
              onClick={handleGoogle}
              disabled={googleLoading}
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 disabled:opacity-50
                         text-gray-800 font-medium rounded-xl py-3 transition-all mb-6"
            >
              {googleLoading ? (
                <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
              )}
              Continue with Google
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-white/30 uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-white/60 mb-1.5">Email</label>
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white/5 text-white rounded-xl px-4 py-3 border border-white/10
                             focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all
                             placeholder:text-white/20"
                  placeholder="you@example.com" required autoComplete="email"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"} value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white/5 text-white rounded-xl px-4 py-3 pr-11 border border-white/10
                               focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all
                               placeholder:text-white/20"
                    placeholder={mode === "signup" ? "Min. 6 characters" : "••••••••"}
                    required autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {mode === "signup" && (
                <div>
                  <label className="block text-sm text-white/60 mb-1.5">Confirm password</label>
                  <input
                    type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-white/5 text-white rounded-xl px-4 py-3 border border-white/10
                               focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all
                               placeholder:text-white/20"
                    placeholder="••••••••" required autoComplete="new-password"
                  />
                </div>
              )}
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}
              {success && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3">
                  <p className="text-green-400 text-sm">{success}</p>
                </div>
              )}
              <button type="submit" disabled={loading}
                className="w-full bg-accent hover:bg-accent/80 disabled:opacity-50 text-white font-medium
                           rounded-xl py-3 transition-all flex items-center justify-center gap-2 group">
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    {mode === "login" ? "Sign in" : "Create account"}
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </>
                )}
              </button>
            </form>

            <p className="text-center text-xs text-white/20 mt-8">
              {mode === "login" ? "Don't have an account? " : "Already have an account? "}
              <button type="button"
                onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setSuccess(""); }}
                className="text-accent/70 hover:text-accent transition">
                {mode === "login" ? "Create one" : "Sign in"}
              </button>
            </p>
          </div>
        </div>
      </div>

      <footer className="px-6 py-4 text-center text-xs text-white/15 border-t border-white/5">
        BeanCount · Every bean, accounted for. &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
}
