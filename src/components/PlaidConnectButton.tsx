"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, PlaidLinkOnSuccess } from "react-plaid-link";
import { Link2, Loader2 } from "lucide-react";
import { callEdgeFunction } from "@/lib/supabase/functions";

interface Props {
  onConnected: () => void;
}

export default function PlaidConnectButton({ onConnected }: Props) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch link token when component mounts
  useEffect(() => {
    callEdgeFunction<{ link_token: string }>("plaid-create-link-token")
      .then((data) => setLinkToken(data.link_token))
      .catch((e) => setError(e.message));
  }, []);

  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    async (public_token, metadata) => {
      setLoading(true);
      try {
        const institutionName = metadata.institution?.name ?? "Bank";
        await callEdgeFunction("plaid-exchange-token", {
          body: { public_token, institution_name: institutionName },
        });
        onConnected();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Connection failed");
      } finally {
        setLoading(false);
      }
    },
    [onConnected]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
  });

  if (error) {
    return (
      <span className="text-xs text-red/70" title={error}>
        Plaid unavailable
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => open()}
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
