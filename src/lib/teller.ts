import https from "node:https";
import fs from "node:fs";

export type TellerEnv = "sandbox" | "development" | "production";

export const TELLER_APP_ID = process.env.TELLER_APP_ID ?? "";
export const TELLER_ENV = (process.env.TELLER_ENV ?? "sandbox") as TellerEnv;

function getAgent(): https.Agent {
  const certPath = process.env.TELLER_CERT_PATH;
  const keyPath = process.env.TELLER_CERT_KEY_PATH;
  if (!certPath || !keyPath) {
    throw new Error(
      "TELLER_CERT_PATH and TELLER_CERT_KEY_PATH must be set in .env.local"
    );
  }
  return new https.Agent({
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
    rejectUnauthorized: true,
  });
}

// Generic GET helper — uses mTLS + basic auth
export function tellerGet<T>(path: string, accessToken: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const agent = getAgent();
    const options: https.RequestOptions = {
      hostname: "api.teller.io",
      path,
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accessToken}:`).toString("base64")}`,
        Accept: "application/json",
      },
      agent,
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Teller ${res.statusCode}: ${raw}`));
        } else {
          try {
            resolve(JSON.parse(raw) as T);
          } catch {
            reject(new Error(`Teller: invalid JSON — ${raw}`));
          }
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

// DELETE helper (for disconnecting enrollments)
export function tellerDelete(path: string, accessToken: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const agent = getAgent();
    const options: https.RequestOptions = {
      hostname: "api.teller.io",
      path,
      method: "DELETE",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accessToken}:`).toString("base64")}`,
      },
      agent,
    };

    const req = https.request(options, (res) => {
      res.resume(); // drain
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Teller DELETE ${res.statusCode}`));
        } else {
          resolve();
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

// ── Teller response types ────────────────────────────────────────────────────

export interface TellerAccount {
  id: string;
  enrollment_id: string;
  institution: { name: string; id: string };
  name: string;
  type: "depository" | "credit";
  subtype: string; // checking, savings, credit_card, etc.
  currency: string;
  last_four: string;
  status: "open" | "closed";
  links: {
    self: string;
    balances?: string;
    transactions?: string;
  };
}

export interface TellerBalance {
  account_id: string;
  available: string | null;
  ledger: string | null;
}

export interface TellerTransaction {
  id: string;
  account_id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: string; // positive = debit, negative = credit
  status: "pending" | "posted";
  type: string;
  details: {
    processing_status: string;
    category: string | null;
    counterparty: { name: string | null; type: string | null } | null;
  };
  links: { self: string; account: string };
}
