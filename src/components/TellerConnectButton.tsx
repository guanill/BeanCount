"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Link2, Loader2 } from "lucide-react";

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
}

export default function TellerConnectButton({ onConnected }: Props) {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tellerRef = useRef<{ open: () => void } | null>(null);

  // Fetch Teller config from server (app ID + env)
  useEffect(() => {
    let cancelled = false;

    async function initTeller() {
      try {
        // Ensure CDN script is loaded
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
          products: ["transactions", "balance"],
          selectAccount: "multiple",
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
              onConnected();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Connection failed");
            } finally {
              setLoading(false);
            }
          },
          onExit: () => {
            /* user dismissed */
          },
        });

        // onInit may not fire in all versions — fallback
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Init failed");
      }
    }

    initTeller();
    return () => { cancelled = true; };
  }, [onConnected]);

  const handleClick = useCallback(() => {
    tellerRef.current?.open();
  }, []);

  if (error) {
    return (
      <span className="text-xs text-red-400/70" title={error}>
        Teller unavailable
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!ready || loading}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                 bg-accent/15 text-accent hover:bg-accent/25 border border-accent/20
                 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Link2 className="w-3.5 h-3.5" />
      )}
      Connect bank
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
