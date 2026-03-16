"use client";

import { CreditCard } from "@/lib/types";
import { formatCurrency, formatNumber, formatDate, daysUntil } from "@/lib/format";
import { CreditCard as CreditCardIcon, AlertTriangle, Plus, Pencil, Trash2, RefreshCw, Unlink, CheckCircle2, WifiOff } from "lucide-react";
import { useState } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { createCreditCard, updateCreditCard, deleteCreditCard } from "@/lib/supabase/queries";
import { callEdgeFunction } from "@/lib/supabase/functions";

const TellerConnectButton = dynamic(() => import("./TellerConnectButton"), { ssr: false });

interface SyncError {
  id: string;
  name: string;
  kind: "account" | "credit_card";
  code: string;
  message: string;
}

interface Props {
  cards: CreditCard[];
  totalDebt: number;
  totalPointsValue: number;
  onRefresh: () => void;
}

export default function CreditCardsSection({ cards, totalDebt, totalPointsValue, onRefresh }: Props) {
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "", balance_owed: "", credit_limit: "", points_balance: "",
    points_value_cents: "1", due_date: "", min_payment: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "", balance_owed: "", credit_limit: "", points_balance: "",
    points_value_cents: "1", due_date: "", min_payment: "",
  });
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<Record<string, SyncError>>({});
  const [editingPointsId, setEditingPointsId] = useState<string | null>(null);
  const [pointsForm, setPointsForm] = useState({ points_balance: "", points_value_cents: "" });

  const linkedCards = cards.filter((c) => c.teller_account_id);
  const hasLinked = linkedCards.length > 0;

  async function handleSync() {
    setSyncing(true); setSyncMsg(null);
    try {
      const data = await callEdgeFunction<{ synced?: number; errors?: SyncError[] }>("teller-sync");

      // Track per-card errors so we can show warnings on each card
      const errMap: Record<string, SyncError> = {};
      for (const err of data.errors ?? []) errMap[err.id] = err;
      setSyncErrors(errMap);

      const failCount = (data.errors ?? []).length;
      if (failCount > 0) {
        setSyncMsg(`✓ ${data.synced} updated · ⚠ ${failCount} failed`);
      } else {
        setSyncMsg(`✓ ${data.synced} updated`);
      }
      onRefresh();
      setTimeout(() => setSyncMsg(null), 4000);
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnectCard(id: string) {
    if (!confirm("Disconnect from Teller? The card stays but won't auto-sync.")) return;
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    await createCreditCard(supabase, {
      name: addForm.name,
      balance_owed: parseFloat(addForm.balance_owed) || 0,
      credit_limit: parseFloat(addForm.credit_limit) || 0,
      points_balance: parseFloat(addForm.points_balance) || 0,
      points_value_cents: parseFloat(addForm.points_value_cents) || 1,
      due_date: addForm.due_date || undefined,
      min_payment: parseFloat(addForm.min_payment) || 0,
    });

    setAddForm({ name: "", balance_owed: "", credit_limit: "", points_balance: "", points_value_cents: "1", due_date: "", min_payment: "" });
    setAdding(false);
    onRefresh();
  }

  async function handleUpdate(id: string) {
    const supabase = createClient();
    await updateCreditCard(supabase, id, {
      name: editForm.name,
      balance_owed: parseFloat(editForm.balance_owed) || 0,
      credit_limit: parseFloat(editForm.credit_limit) || 0,
      points_balance: parseFloat(editForm.points_balance) || 0,
      points_value_cents: parseFloat(editForm.points_value_cents) || 1,
      due_date: editForm.due_date || null,
      min_payment: parseFloat(editForm.min_payment) || 0,
    } as any);

    setEditingId(null);
    onRefresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this credit card?")) return;
    const supabase = createClient();
    await deleteCreditCard(supabase, id);
    onRefresh();
  }

  function startEdit(card: CreditCard) {
    setEditingId(card.id);
    setEditForm({
      name: card.name,
      balance_owed: card.balance_owed.toString(),
      credit_limit: card.credit_limit.toString(),
      points_balance: card.points_balance.toString(),
      points_value_cents: card.points_value_cents.toString(),
      due_date: card.due_date || "",
      min_payment: card.min_payment.toString(),
    });
  }

  function startEditPoints(card: CreditCard) {
    setEditingPointsId(card.id);
    setPointsForm({
      points_balance: card.points_balance.toString(),
      points_value_cents: card.points_value_cents.toString(),
    });
  }

  async function handleUpdatePoints(id: string) {
    const supabase = createClient();
    await updateCreditCard(supabase, id, {
      points_balance: parseFloat(pointsForm.points_balance) || 0,
      points_value_cents: parseFloat(pointsForm.points_value_cents) || 1,
    } as any);
    setEditingPointsId(null);
    onRefresh();
  }

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Credit Card Debt */}
      <div className="rounded-2xl bg-linear-to-br from-red-500/15 to-orange-500/10 border border-border/50 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 sm:p-2.5 rounded-xl bg-red-500/20 shrink-0">
              <CreditCardIcon className="w-4 h-4 sm:w-5 sm:h-5 text-red" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-lg font-bold text-foreground">Credit Card Debt</h2>
              <p className="text-[10px] sm:text-sm text-foreground/50">
                {cards.length} card{cards.length !== 1 ? "s" : ""}
                {hasLinked && (
                  <span className="ml-1 sm:ml-1.5 inline-flex items-center gap-1 text-accent/80">
                    · <CheckCircle2 className="w-3 h-3" /> {linkedCards.length} linked
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className={`text-lg sm:text-2xl font-bold ${totalDebt <= 0 ? "text-green" : "text-red"}`}>
              {totalDebt <= 0 ? formatCurrency(Math.abs(totalDebt)) : `-${formatCurrency(totalDebt)}`}
            </p>
            <div className="flex items-center gap-2 justify-end mt-1">
              {hasLinked && (
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={syncing}
                  className={`hidden sm:flex items-center gap-1 text-xs transition-colors disabled:opacity-40 ${
                    syncMsg?.includes("failed")
                      ? "text-yellow-400 hover:text-yellow-300"
                      : "text-foreground/50 hover:text-accent"
                  }`}
                >
                  <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
                  {syncMsg ?? (syncing ? "Syncing…" : "Sync")}
                </button>
              )}
              <button
                onClick={() => { setAdding(!adding); setAddForm({ name: "", balance_owed: "", credit_limit: "", points_balance: "", points_value_cents: "1", due_date: "", min_payment: "" }); }}
                className="text-[10px] sm:text-xs text-accent-light hover:text-accent transition-colors flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
          </div>
        </div>

        {adding && (
          <form onSubmit={handleCreate} className="mb-4 p-4 bg-card rounded-xl border border-border/50 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-foreground/50 block mb-1">Card Name</label>
                <input type="text" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" required />
              </div>
              <div>
                <label className="text-xs text-foreground/50 block mb-1">Balance Owed</label>
                <input type="number" step="0.01" value={addForm.balance_owed} onChange={(e) => setAddForm({ ...addForm, balance_owed: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="text-xs text-foreground/50 block mb-1">Credit Limit</label>
                <input type="number" step="0.01" value={addForm.credit_limit} onChange={(e) => setAddForm({ ...addForm, credit_limit: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="text-xs text-foreground/50 block mb-1">Min Payment</label>
                <input type="number" step="0.01" value={addForm.min_payment} onChange={(e) => setAddForm({ ...addForm, min_payment: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="text-xs text-foreground/50 block mb-1">Points Balance</label>
                <input type="number" value={addForm.points_balance} onChange={(e) => setAddForm({ ...addForm, points_balance: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="text-xs text-foreground/50 block mb-1">Point Value (cents)</label>
                <input type="number" step="0.1" value={addForm.points_value_cents} onChange={(e) => setAddForm({ ...addForm, points_value_cents: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="text-xs text-foreground/50 block mb-1">Due Date</label>
                <input type="date" value={addForm.due_date} onChange={(e) => setAddForm({ ...addForm, due_date: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm hover:bg-accent-light transition-colors">
                Add Card
              </button>
              <button type="button" onClick={() => { setAdding(false); setAddForm({ name: "", balance_owed: "", credit_limit: "", points_balance: "", points_value_cents: "1", due_date: "", min_payment: "" }); }} className="px-3 py-1.5 text-foreground/50 hover:text-foreground text-sm transition-colors">
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="space-y-3">
          {cards.map((card) => {
            const utilization = card.credit_limit > 0 ? (card.balance_owed / card.credit_limit) * 100 : 0;
            const days = daysUntil(card.due_date);
            const isUrgent = days !== null && days <= 7 && days >= 0;
            const pointsVal = (card.points_balance * card.points_value_cents) / 100;
            const syncErr = syncErrors[card.id];
            const needsReconnect = syncErr?.code?.startsWith("enrollment.disconnected");

            return (
              <div key={card.id} className={`group p-4 rounded-xl bg-card/60 hover:bg-card-hover border transition-all overflow-hidden ${needsReconnect ? "border-yellow-500/40 hover:border-yellow-500/60" : "border-transparent hover:border-border/30"}`}>
                {editingId === card.id ? (
                  <div className="space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div
                          className="w-10 h-6 rounded-md shrink-0"
                          style={{ backgroundColor: card.color || "#666" }}
                        />
                        <input
                          type="text"
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="min-w-0 flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div className="flex items-center gap-2 sm:ml-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleUpdate(card.id)}
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
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="text-foreground/50 block mb-1">Balance Owed</label>
                        <input
                          type="number"
                          step="0.01"
                          value={editForm.balance_owed}
                          onChange={(e) => setEditForm({ ...editForm, balance_owed: e.target.value })}
                          className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="text-foreground/50 block mb-1">Credit Limit</label>
                        <input
                          type="number"
                          step="0.01"
                          value={editForm.credit_limit}
                          onChange={(e) => setEditForm({ ...editForm, credit_limit: e.target.value })}
                          className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="text-foreground/50 block mb-1">Min Payment</label>
                        <input
                          type="number"
                          step="0.01"
                          value={editForm.min_payment}
                          onChange={(e) => setEditForm({ ...editForm, min_payment: e.target.value })}
                          className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="text-foreground/50 block mb-1">Due Date</label>
                        <input
                          type="date"
                          value={editForm.due_date}
                          onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })}
                          className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="text-foreground/50 block mb-1">Points Balance</label>
                        <input
                          type="number"
                          value={editForm.points_balance}
                          onChange={(e) => setEditForm({ ...editForm, points_balance: e.target.value })}
                          className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="text-foreground/50 block mb-1">Point Value (cents)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={editForm.points_value_cents}
                          onChange={(e) => setEditForm({ ...editForm, points_value_cents: e.target.value })}
                          className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-accent"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-6 rounded-md"
                          style={{ backgroundColor: card.color || "#666" }}
                        />
                        <div>
                          <p className="text-sm font-semibold text-foreground">{card.name}</p>
                          {card.due_date && (
                            <p className={`text-xs ${isUrgent ? "text-red font-semibold" : "text-foreground/40"}`}>
                              {isUrgent && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                              Due {formatDate(card.due_date)} {days !== null && `(${days}d)`}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className={`text-lg font-bold ${card.balance_owed < 0 ? "text-green" : "text-red"}`}>
                            {formatCurrency(Math.abs(card.balance_owed))}
                          </p>
                          <p className="text-xs text-foreground/40">Min: {formatCurrency(card.min_payment)}</p>
                        </div>
                        <div className="hidden group-hover:flex items-center gap-1">
                          {!card.teller_account_id && (
                            <button onClick={() => startEdit(card)} className="p-1 text-foreground/30 hover:text-accent transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {card.teller_account_id && (
                            <button onClick={() => handleDisconnectCard(card.id)} className="p-1 text-foreground/30 hover:text-yellow-400 transition-colors" title="Disconnect Teller">
                              <Unlink className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => handleDelete(card.id)} className="p-1 text-foreground/30 hover:text-red transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-background rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${utilization > 70 ? "bg-red" : utilization > 30 ? "bg-yellow" : "bg-green"}`}
                          style={{ width: `${Math.min(utilization, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-foreground/40 w-12 text-right">{utilization.toFixed(0)}%</span>
                    </div>
                    {card.points_balance > 0 && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-foreground/50">
                        <span className="text-yellow">★</span>
                        <span>{formatNumber(card.points_balance)} pts</span>
                        <span>≈ {formatCurrency(pointsVal)}</span>
                      </div>
                    )}
                    {syncErr && (
                      <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs">
                        <WifiOff className="w-3.5 h-3.5 text-yellow-400 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-yellow-300 font-medium">
                            {needsReconnect ? "Re-authentication required" : "Sync failed"}
                          </p>
                          {needsReconnect ? (
                            <TellerConnectButton
                              variant="ghost"
                              enrollmentId={card.teller_enrollment_id ?? undefined}
                              onConnected={() => {
                                setSyncErrors(prev => {
                                  const next = { ...prev };
                                  delete next[card.id];
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
        </div>
      </div>

      {/* Points Value Summary */}
      <div className="rounded-2xl bg-linear-to-br from-yellow-500/15 to-amber-500/10 border border-border/50 p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2.5 rounded-xl bg-yellow-500/20">
            <span className="text-xl">★</span>
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Rewards Points Value</h2>
            <p className="text-sm text-foreground/50">Combined value across all cards</p>
          </div>
        </div>
        <p className="text-3xl font-bold text-yellow">{formatCurrency(totalPointsValue)}</p>
        <div className="mt-3 space-y-2">
          {cards.map(card => {
            const val = (card.points_balance * card.points_value_cents) / 100;
            const isEditingPoints = editingPointsId === card.id;
            return (
              <div key={card.id} className="group">
                {isEditingPoints ? (
                  <div className="flex items-center gap-2 py-1">
                    <span className="text-sm text-foreground/70 flex-1 truncate">{card.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="flex flex-col items-end">
                        <label className="text-[10px] text-foreground/40 mb-0.5">Points</label>
                        <input
                          type="number"
                          value={pointsForm.points_balance}
                          onChange={e => setPointsForm({ ...pointsForm, points_balance: e.target.value })}
                          className="w-28 bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground text-right focus:outline-none focus:border-accent"
                          autoFocus
                        />
                      </div>
                      <div className="flex flex-col items-end">
                        <label className="text-[10px] text-foreground/40 mb-0.5">¢ / pt</label>
                        <input
                          type="number"
                          step="0.01"
                          value={pointsForm.points_value_cents}
                          onChange={e => setPointsForm({ ...pointsForm, points_value_cents: e.target.value })}
                          className="w-16 bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground text-right focus:outline-none focus:border-accent"
                        />
                      </div>
                      <button
                        onClick={() => handleUpdatePoints(card.id)}
                        className="px-2.5 py-1.5 bg-accent text-white rounded-lg text-xs hover:bg-accent-light transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingPointsId(null)}
                        className="px-2 py-1.5 text-foreground/50 hover:text-foreground text-xs transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-sm py-1 gap-2">
                    <span className="text-foreground/60 truncate min-w-0">{card.name}</span>
                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                      <span className="text-foreground/40 text-xs sm:text-sm whitespace-nowrap">
                        {formatNumber(card.points_balance)} × {card.points_value_cents}¢
                      </span>
                      <span className="text-yellow font-semibold whitespace-nowrap">{formatCurrency(val)}</span>
                      <button
                        onClick={() => startEditPoints(card)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-foreground/30 hover:text-accent transition-all"
                        title="Edit points"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {cards.length === 0 && (
            <p className="text-xs text-foreground/30">No cards yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
