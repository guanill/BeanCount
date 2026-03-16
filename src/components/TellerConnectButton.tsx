"use client";

import { useEffect, useRef, useState } from "react";
import { Link2, Loader2, RefreshCw } from "lucide-react";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    TellerConnect?: {
      setup: (config: any) => { open: () => void };
    };
  }
}

interface Props {
  onConnected: () => void;
  /** When set, opens Teller Connect in re-authentication mode for that enrollment */
  enrollmentId?: string;
  /** ghost = small inline link style (for per-row reconnect banners) */
  variant?: "default" | "ghost";
}

export default function TellerConnectButton({
  onConnected,
  enrollmentId,
  variant = "default",
}: Props) {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tellerRef = useRef<{ open: () => void } | null>(null);

  // Keep latest callback in a ref so the Teller SDK instance doesn't need to
  // be recreated every time the parent re-renders with a new inline function.
  const onConnectedRef = useRef(onConnected);
  useEffect(() => { onConnectedRef.current = onConnected; });

  // Re-initialize Teller if enrollmentId changes (different card reconnect)
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);

    async function initTeller() {
      try {
        await loadScript("https://cdn.teller.io/connect/connect.js");
        if (cancelled) return;

        const cfgRes = await fetch("/api/teller/config");
        const { appId, environment } = await cfgRes.json() as { appId: string; environment: string };
        if (cancelled) return;

        if (!window.TellerConnect) {
          setError("Teller Connect failed to load");
          return;
        }

        tellerRef.current = window.TellerConnect.setup({
          applicationId: appId,
          environment,
          // Reconnect mode: pass enrollmentId so Teller skips account selection
          // and just asks the user to re-authenticate the existing enrollment.
          ...(enrollmentId ? { enrollmentId } : { selectAccount: "multiple" }),
          products: ["transactions", "balance"],
          onInit: () => setReady(true),
          onSuccess: async (enrollment: { accessToken: string; enrollment: { id: string; institution: { name: string } } }) => {
            setLoading(true);
            try {
              const res = await fetch("/api/teller/enroll", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  access_token: enrollment.accessToken,
                  enrollment_id: enrollment.enrollment.id,
                  institution_name: enrollment.enrollment.institution.name,
                }),
              });
              const data = await res.json() as { error?: string };
              if (data.error) throw new Error(data.error);
              onConnectedRef.current();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Connection failed");
            } finally {
              setLoading(false);
            }
          },
          onExit: () => { /* user dismissed */ },
        });

        setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Init failed");
      }
    }

    initTeller();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollmentId]);

  const isReconnect = !!enrollmentId;

  if (error) {
    if (variant === "ghost") {
      return (
        <span className="text-xs text-red-400/60" title={error}>Unavailable</span>
      );
    }
    return (
      <span className="text-xs text-red-400/70" title={error}>Teller unavailable</span>
    );
  }

  if (variant === "ghost") {
    return (
      <button
        type="button"
        onClick={() => tellerRef.current?.open()}
        disabled={!ready || loading}
        className="mt-1 text-yellow-400 hover:text-yellow-300 underline underline-offset-2 transition-colors disabled:opacity-40 text-xs flex items-center gap-1"
      >
        {loading
          ? <><Loader2 className="w-3 h-3 animate-spin" /> Reconnecting…</>
          : <>{isReconnect ? "Re-authenticate →" : "Connect"}</>}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => tellerRef.current?.open()}
      disabled={!ready || loading}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                 bg-accent/15 text-accent hover:bg-accent/25 border border-accent/20
                 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : isReconnect ? (
        <RefreshCw className="w-3.5 h-3.5" />
      ) : (
        <Link2 className="w-3.5 h-3.5" />
      )}
      {isReconnect ? "Reconnect" : "Connect bank"}
    </button>
  );
}

// Dynamically load a script tag once
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(s);
  });
}
