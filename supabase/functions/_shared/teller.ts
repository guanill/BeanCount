// Teller API helper for Edge Functions.
// Routes through a mTLS proxy when TELLER_PROXY_URL is set (required for
// development/production). Falls back to direct API calls for sandbox.

export interface TellerAccount {
  id: string;
  enrollment_id: string;
  institution: { name: string; id: string };
  name: string;
  type: "depository" | "credit";
  subtype: string;
  currency: string;
  last_four: string;
  status: "open" | "closed";
  links: { self: string; balances?: string; transactions?: string };
}

export interface TellerBalance {
  account_id: string;
  available: string | null;
  ledger: string | null;
}

export interface TellerTransaction {
  id: string;
  account_id: string;
  date: string;
  description: string;
  amount: string;
  status: "pending" | "posted";
  type: string;
  details: {
    processing_status: string;
    category: string | null;
    counterparty: { name: string | null; type: string | null } | null;
  };
  links: { self: string; account: string };
}

export async function tellerFetch<T>(
  path: string,
  accessToken: string,
  method = "GET",
): Promise<T> {
  const proxyUrl = Deno.env.get("TELLER_PROXY_URL");
  const proxySecret = Deno.env.get("TELLER_PROXY_SECRET");

  let resp: Response;

  if (proxyUrl) {
    // Route through mTLS proxy for real bank connections
    resp = await fetch(`${proxyUrl}/teller${path}`, {
      method,
      headers: {
        "x-teller-token": accessToken,
        "x-proxy-secret": proxySecret ?? "",
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
  } else {
    // Direct call — works in sandbox only
    resp = await fetch(`https://api.teller.io${path}`, {
      method,
      headers: {
        Authorization: `Basic ${btoa(`${accessToken}:`)}`,
        Accept: "application/json",
      },
    });
  }

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Teller ${resp.status}: ${body}`);
  }
  if (method === "DELETE") return undefined as T;
  return resp.json() as Promise<T>;
}

export function parseTellerError(e: unknown): { code: string; message: string } {
  const msg = e instanceof Error ? e.message : String(e);
  try {
    const jsonStart = msg.indexOf("{");
    if (jsonStart !== -1) {
      const parsed = JSON.parse(msg.slice(jsonStart)) as { error?: { code?: string; message?: string } };
      if (parsed.error?.code) return { code: parsed.error.code, message: parsed.error.message ?? msg };
    }
  } catch { /* ignore */ }
  return { code: "unknown", message: msg };
}
