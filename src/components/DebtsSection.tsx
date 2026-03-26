"use client";

import { DebtOwed } from "@/lib/types";
import { formatCurrency, formatDate, daysUntil } from "@/lib/format";
import { Users, Plus, Pencil, Trash2, Check, Clock } from "lucide-react";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { createDebt, updateDebt, deleteDebt } from "@/lib/supabase/queries";

interface Props {
  debts: DebtOwed[];
  total: number;
  onRefresh: () => void;
}

export default function DebtsSection({ debts, total, onRefresh }: Props) {
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({
    person_name: "", amount: "", reason: "", due_date: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    person_name: "", amount: "", reason: "", due_date: "",
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      const supabase = createClient();
      await createDebt(supabase, {
        person_name: addForm.person_name,
        amount: parseFloat(addForm.amount) || 0,
        reason: addForm.reason || undefined,
        due_date: addForm.due_date || undefined,
      });
      setAddForm({ person_name: "", amount: "", reason: "", due_date: "" });
      setAdding(false);
      onRefresh();
    } catch (e) {
      console.error("Failed to add debt:", e);
      alert("Failed to add debt. Please try again.");
    }
  }

  async function handleUpdate(id: string) {
    try {
      const supabase = createClient();
      await updateDebt(supabase, id, {
        person_name: editForm.person_name,
        amount: parseFloat(editForm.amount) || 0,
        reason: editForm.reason || null,
        due_date: editForm.due_date || null,
      } as any);
      setEditingId(null);
      onRefresh();
    } catch (e) {
      console.error("Failed to update debt:", e);
      alert("Failed to update debt. Please try again.");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this debt?")) return;
    try {
      const supabase = createClient();
      await deleteDebt(supabase, id);
      onRefresh();
    } catch (e) {
      console.error("Failed to delete debt:", e);
      alert("Failed to delete debt. Please try again.");
    }
  }

  async function markPaid(id: string) {
    try {
      const supabase = createClient();
      await updateDebt(supabase, id, { status: "paid" } as any);
      onRefresh();
    } catch (e) {
      console.error("Failed to mark as paid:", e);
      alert("Failed to mark as paid. Please try again.");
    }
  }

  function startEdit(debt: DebtOwed) {
    setEditingId(debt.id);
    setEditForm({
      person_name: debt.person_name,
      amount: debt.amount.toString(),
      reason: debt.reason || "",
      due_date: debt.due_date || "",
    });
  }

  function getInitials(name: string) {
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  }

  // Deterministic color based on name
  function getAvatarColor(name: string) {
    const colors = ["#6c5ce7", "#00b894", "#e17055", "#0984e3", "#fdcb6e", "#00cec9", "#e84393", "#2d3436"];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  return (
    <div className="rounded-2xl bg-linear-to-br from-purple-500/15 to-indigo-500/10 border border-border/50 p-4 sm:p-6 animate-slide-up">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 sm:p-2.5 rounded-xl bg-purple-500/20 shrink-0">
            <Users className="w-4 h-4 sm:w-5 sm:h-5 text-accent-light" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-lg font-bold text-foreground">People Owe You</h2>
            <p className="text-[10px] sm:text-sm text-foreground/50">{debts.length} pending</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg sm:text-2xl font-bold text-green">{formatCurrency(total)}</p>
          <button
              onClick={() => { setAdding(true); setAddForm({ person_name: "", amount: "", reason: "", due_date: "" }); }}
            className="text-[10px] sm:text-xs text-accent-light hover:text-accent transition-colors flex items-center gap-1 mt-1 ml-auto"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
      </div>

        {adding && (
          <form onSubmit={handleCreate} className="mb-4 p-4 bg-card rounded-xl border border-border/50 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-foreground/50 block mb-1">Person</label>
                <input type="text" value={addForm.person_name} onChange={(e) => setAddForm({ ...addForm, person_name: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" required />
            </div>
            <div>
              <label className="text-xs text-foreground/50 block mb-1">Amount</label>
                <input type="number" step="0.01" value={addForm.amount} onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" required />
            </div>
            <div>
              <label className="text-xs text-foreground/50 block mb-1">Reason</label>
                <input type="text" value={addForm.reason} onChange={(e) => setAddForm({ ...addForm, reason: e.target.value })}
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
                Add Debt
            </button>
              <button type="button" onClick={() => { setAdding(false); setAddForm({ person_name: "", amount: "", reason: "", due_date: "" }); }} className="px-3 py-1.5 text-foreground/50 hover:text-foreground text-sm transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {debts.map((debt) => {
          const days = daysUntil(debt.due_date);
          const isOverdue = days !== null && days < 0;
          const avatarColor = getAvatarColor(debt.person_name);

          return (
            <div key={debt.id} className="group p-3 rounded-xl bg-card/60 hover:bg-card-hover border border-transparent hover:border-border/30 transition-all overflow-hidden">
              {editingId === debt.id ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: avatarColor }}
                    >
                      {getInitials(debt.person_name)}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <input
                        type="text"
                        value={editForm.person_name}
                        onChange={(e) => setEditForm({ ...editForm, person_name: e.target.value })}
                        className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
                      />
                      <div className="flex items-center gap-2 text-xs text-foreground/40">
                        <input
                          type="text"
                          placeholder="Reason"
                          value={editForm.reason}
                          onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                          className="min-w-0 flex-1 bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:border-accent"
                        />
                        <input
                          type="date"
                          value={editForm.due_date}
                          onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })}
                          className="w-32 bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:border-accent"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:ml-2 shrink-0">
                    <input
                      type="number"
                      step="0.01"
                      value={editForm.amount}
                      onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                      className="w-24 bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-foreground text-right focus:outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      onClick={() => handleUpdate(debt.id)}
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
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: avatarColor }}
                    >
                      {getInitials(debt.person_name)}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{debt.person_name}</p>
                      <div className="flex items-center gap-2 text-xs text-foreground/40">
                        {debt.reason && <span>{debt.reason}</span>}
                        {debt.due_date && (
                          <span className={`flex items-center gap-0.5 ${isOverdue ? "text-red" : ""}`}>
                            <Clock className="w-3 h-3" />
                            {formatDate(debt.due_date)}
                            {isOverdue && " (overdue!)"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-green">{formatCurrency(debt.amount)}</span>
                    <div className="hidden group-hover:flex items-center gap-1">
                      <button onClick={() => markPaid(debt.id)} className="p-1 text-foreground/30 hover:text-green transition-colors" title="Mark as paid">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => startEdit(debt)} className="p-1 text-foreground/30 hover:text-accent transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(debt.id)} className="p-1 text-foreground/30 hover:text-red transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {debts.length === 0 && (
          <p className="text-center text-foreground/30 text-sm py-4">No one owes you anything</p>
        )}
      </div>
    </div>
  );
}
