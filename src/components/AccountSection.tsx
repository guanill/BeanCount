"use client";

import { Account, AccountType } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import {
  Landmark,
  TrendingUp,
  Bitcoin,
  PiggyBank,
  BarChart2,
  LineChart,
  Hexagon,
  Zap,
  Building,
  Pencil,
  Trash2,
  Plus,
  RefreshCw,
  Unlink,
  CheckCircle2,
  WifiOff,
} from "lucide-react";
import { useState } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { createAccount, updateAccount, deleteAccount } from "@/lib/supabase/queries";
import { callEdgeFunction } from "@/lib/supabase/functions";

// Teller Connect contains browser-only code — load client-side only
const TellerConnectButton = dynamic(() => import("./TellerConnectButton"), { ssr: false });

interface SyncError {
  id: string;
  name: string;
  kind: "account" | "credit_card";
  code: string;
  message: string;
}

const typeConfig: Record<AccountType, { label: string; gradient: string; iconBg: string; Icon: React.ElementType }> = {
  bank: { label: "Bank Accounts", gradient: "from-blue-500/20 to-cyan-500/10", iconBg: "bg-blue-500/20", Icon: Landmark },
  stock: { label: "Stock & Investments", gradient: "from-green-500/20 to-emerald-500/10", iconBg: "bg-green-500/20", Icon: TrendingUp },
  crypto: { label: "Cryptocurrency", gradient: "from-yellow-500/20 to-orange-500/10", iconBg: "bg-yellow-500/20", Icon: Bitcoin },
};

const iconMap: Record<string, React.ElementType> = {
  "building": Building,
  "piggy-bank": PiggyBank,
  "landmark": Landmark,
  "trending-up": TrendingUp,
  "bar-chart-2": BarChart2,
  "line-chart": LineChart,
  "bitcoin": Bitcoin,
  "hexagon": Hexagon,
  "zap": Zap,
};

interface Props {
  type: AccountType;
  accounts: Account[];
  total: number;
  onRefresh: () => void;
}

export default function AccountSection({ type, accounts, total, onRefresh }: Props) {
  const { label, gradient, iconBg, Icon } = typeConfig[type];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValues, setEditingValues] = useState<{ name: string; balance: string }>({ name: "", balance: "" });
  const [adding, setAdding] = useState(false);
  const [addValues, setAddValues] = useState<{ name: string; balance: string }>({ name: "", balance: "" });
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<Record<string, SyncError>>({});

  const linkedAccounts = accounts.filter((a) => a.teller_account_id);
  const hasLinked = linkedAccounts.length > 0;

  async function handleDelete(id: string) {
    if (!confirm("Delete this account?")) return;
    const supabase = createClient();
    await deleteAccount(supabase, id);
    onRefresh();
  }

  function startEdit(account: Account) {
    setEditingId(account.id);
    setEditingValues({ name: account.name, balance: account.balance.toString() });
  }

  async function saveEdit(id: string) {
    const supabase = createClient();
    await updateAccount(supabase, id, {
      name: editingValues.name,
      balance: parseFloat(editingValues.balance) || 0,
    });

    setEditingId(null);
    onRefresh();
  }

  async function saveNew() {
    const supabase = createClient();
    await createAccount(supabase, {
      name: addValues.name,
      type,
      balance: parseFloat(addValues.balance) || 0,
    });

    setAddValues({ name: "", balance: "" });
    setAdding(false);
    onRefresh();
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const data = await callEdgeFunction<{ synced?: number; errors?: SyncError[] }>("teller-sync");

      // Track per-account errors so we can show inline reconnect banners
      const errMap: Record<string, SyncError> = {};
      for (const err of data.errors ?? []) errMap[err.id] = err;
      setSyncErrors(errMap);

      const failCount = (data.errors ?? []).length;
      setSyncMsg(failCount > 0 ? `✓ ${data.synced} updated · ⚠ ${failCount} failed` : `✓ ${data.synced} updated`);
      onRefresh();
      setTimeout(() => setSyncMsg(null), 4000);
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect(id: string) {
    if (!confirm("Disconnect from Teller? The account stays but won't auto-sync.")) return;
    await callEdgeFunction("teller-disconnect", { method: "POST", body: { id } });
    onRefresh();
  }

  function formatSynced(ts: string | null): string {
    if (!ts) return "never";
    const diff = Math.round((Date.now() - new Date(ts + "Z").getTime()) / 60000);
    if (diff < 1) return "just now";
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.round(diff / 60)}h ago`;
    return `${Math.round(diff / 1440)}d ago`;
  }

  return (
    <div className={`rounded-2xl bg-linear-to-br ${gradient} border border-border/50 p-4 sm:p-6 animate-slide-up`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2.5 rounded-xl shrink-0 ${iconBg}`}>
            <Icon className="w-5 h-5 text-foreground" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-foreground truncate">{label}</h2>
            <p className="text-xs sm:text-sm text-foreground/50">
              {accounts.length} account{accounts.length !== 1 ? "s" : ""}
              {hasLinked && (
                <span className="ml-1.5 inline-flex items-center gap-1 text-accent/80">
                  · <CheckCircle2 className="w-3 h-3" /> {linkedAccounts.length} linked
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 justify-between sm:justify-end">
          {hasLinked && (
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              title="Sync balances from your bank"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-foreground/60
                         hover:text-accent border border-border/40 hover:border-accent/30 transition-colors
                         disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              <span className={syncMsg?.includes("failed") ? "text-yellow-400" : ""}>
                {syncMsg ?? (syncing ? "Syncing…" : "Sync")}
              </span>
            </button>
          )}
          <div className="text-right">
            <p className="text-xl sm:text-2xl font-bold text-foreground">{formatCurrency(total)}</p>
            <button
              onClick={() => { setAdding(!adding); setEditingId(null); setAddValues({ name: "", balance: "" }); }}
              className="text-xs text-accent-light hover:text-accent transition-colors flex items-center gap-1 mt-1 ml-auto"
            >
              <Plus className="w-3 h-3" /> Add manually
            </button>
          </div>
        </div>
      </div>

      {/* Real bank connection (bank accounts only) */}
      {type === "bank" && (
        <div className="mb-4 flex items-center gap-3 p-3 rounded-xl bg-card/50 border border-accent/10">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground/80">Connect your real bank</p>
            <p className="text-xs text-foreground/40 mt-0.5">Securely link via Teller — balances update with one tap</p>
          </div>
          <TellerConnectButton onConnected={onRefresh} />
        </div>
      )}

      <div className="space-y-2">
        {adding && (
          <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border/60 overflow-hidden">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-background/60">
                <Plus className="w-4 h-4 text-accent" />
              </div>
              <input
                type="text"
                placeholder="Account name"
                value={addValues.name}
                onChange={(e) => setAddValues({ ...addValues, name: e.target.value })}
                className="min-w-0 flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
              />
            </div>
            <div className="flex items-center gap-2 ml-2 shrink-0">
              <input
                type="number"
                step="0.01"
                placeholder="Balance"
                value={addValues.balance}
                onChange={(e) => setAddValues({ ...addValues, balance: e.target.value })}
                className="w-24 bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-foreground text-right focus:outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={saveNew}
                className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs hover:bg-accent-light transition-colors"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => { setAdding(false); setAddValues({ name: "", balance: "" }); }}
                className="px-2 py-1.5 text-foreground/50 hover:text-foreground text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {accounts.map((account, i) => {
          const AccIcon = iconMap[account.icon || ""] || Landmark;
          const isLinked = !!account.teller_account_id;
          const syncErr = syncErrors[account.id];
          const needsReconnect = syncErr?.code?.startsWith("enrollment.disconnected");
          return (
            <div
              key={account.id}
              className={`group p-3 rounded-xl bg-card/60 hover:bg-card-hover border transition-all overflow-hidden ${
                syncErr ? "border-yellow-500/40 hover:border-yellow-500/60" : "border-transparent hover:border-border/30"
              }`}
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              {editingId === account.id ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${account.color || "#444"}20` }}
                    >
                      <AccIcon className="w-4 h-4" style={{ color: account.color || undefined }} />
                    </div>
                    <input
                      type="text"
                      value={editingValues.name}
                      onChange={(e) => setEditingValues({ ...editingValues, name: e.target.value })}
                      className="min-w-0 flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div className="flex items-center gap-2 sm:ml-2 shrink-0">
                    <input
                      type="number"
                      step="0.01"
                      value={editingValues.balance}
                      onChange={(e) => setEditingValues({ ...editingValues, balance: e.target.value })}
                      className="w-24 bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-foreground text-right focus:outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      onClick={() => saveEdit(account.id)}
                      className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs hover:bg-accent-light transition-colors"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="px-2 py-1.5 text-foreground/50 hover:text-foreground text-xs transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${account.color}20` }}
                      >
                        <AccIcon className="w-4 h-4" style={{ color: account.color || undefined }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{account.name}</p>
                        {isLinked && !syncErr && (
                          <p className="text-xs text-accent/60 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Teller · {formatSynced(account.teller_last_synced)}
                          </p>
                        )}
                        {syncErr && (
                          <p className="text-xs text-yellow-400/80 flex items-center gap-1">
                            <WifiOff className="w-3 h-3" />
                            {needsReconnect ? "Re-auth required" : "Sync failed"}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-bold text-foreground">{formatCurrency(account.balance)}</span>
                      <div className="hidden group-hover:flex items-center gap-1">
                        {!isLinked && (
                          <button onClick={() => startEdit(account)} className="p-1 text-foreground/30 hover:text-accent transition-colors" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isLinked && (
                          <button onClick={() => handleDisconnect(account.id)} className="p-1 text-foreground/30 hover:text-yellow-400 transition-colors" title="Disconnect Teller">
                            <Unlink className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button onClick={() => handleDelete(account.id)} className="p-1 text-foreground/30 hover:text-red transition-colors" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Inline reconnect banner */}
                  {syncErr && (
                    <div className="mt-2 flex items-start gap-2 p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs">
                      <WifiOff className="w-3.5 h-3.5 text-yellow-400 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-yellow-300 font-medium">
                          {needsReconnect ? "Re-authentication required" : "Sync failed"}
                        </p>
                        {needsReconnect ? (
                          <TellerConnectButton
                            variant="ghost"
                            enrollmentId={account.teller_enrollment_id ?? undefined}
                            onConnected={() => {
                              setSyncErrors(prev => {
                                const next = { ...prev };
                                delete next[account.id];
                                return next;
                              });
                              onRefresh();
                            }}
                          />
                        ) : (
                          <p className="text-foreground/40 truncate mt-0.5">{syncErr.message}</p>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
        {accounts.length === 0 && (
          <p className="text-center text-foreground/30 text-sm py-4">No accounts yet</p>
        )}
      </div>
    </div>
  );
}
