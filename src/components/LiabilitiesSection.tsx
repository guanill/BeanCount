"use client";

import { Liability } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { Landmark, Plus, Pencil, Trash2, Clock } from "lucide-react";
import { useState } from "react";

const CATEGORIES = [
  { value: "pending",    label: "Pending Charge",  emoji: "⏳" },
  { value: "person",     label: "Owe Someone",     emoji: "🤝" },
  { value: "bill",       label: "Bill / Invoice",  emoji: "🧾" },
  { value: "split",      label: "Split / Tab",     emoji: "🍽️" },
  { value: "refund",     label: "Awaiting Refund", emoji: "↩️" },
  { value: "other",      label: "Other",           emoji: "📌" },
];

function getCat(value: string) {
  return CATEGORIES.find(c => c.value === value) ?? CATEGORIES[CATEGORIES.length - 1];
}

function formatDate(d: string) {
  const [y, m, day] = d.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m) - 1]} ${parseInt(day)}, ${y}`;
}

function daysUntil(d: string | null) {
  if (!d) return null;
  const diff = new Date(d).getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.ceil(diff / 86400000);
}

const EMPTY_FORM = { name: "", amount: "", category: "other", notes: "", due_date: "" };

interface Props {
  liabilities: Liability[];
  total: number;
  onRefresh: () => void;
}

export default function LiabilitiesSection({ liabilities, total, onRefresh }: Props) {
  const [adding, setAdding]   = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editForm, setEditForm]     = useState(EMPTY_FORM);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/liabilities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:     addForm.name,
        amount:   parseFloat(addForm.amount) || 0,
        category: addForm.category,
        notes:    addForm.notes || null,
        due_date: addForm.due_date || null,
      }),
    });
    setAddForm(EMPTY_FORM);
    setAdding(false);
    onRefresh();
  }

  async function handleUpdate(id: string) {
    await fetch(`/api/liabilities/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:     editForm.name,
        amount:   parseFloat(editForm.amount) || 0,
        category: editForm.category,
        notes:    editForm.notes || null,
        due_date: editForm.due_date || null,
      }),
    });
    setEditingId(null);
    onRefresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this liability?")) return;
    await fetch(`/api/liabilities/${id}`, { method: "DELETE" });
    onRefresh();
  }

  function startEdit(l: Liability) {
    setEditingId(l.id);
    setEditForm({
      name:     l.name,
      amount:   l.amount.toString(),
      category: l.category,
      notes:    l.notes ?? "",
      due_date: l.due_date ?? "",
    });
  }

  return (
    <div className="rounded-2xl bg-linear-to-br from-orange-500/15 to-red-500/10 border border-border/50 p-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-orange-500/20">
            <Landmark className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Pending & Owed</h2>
            <p className="text-sm text-foreground/50">Money you owe not tracked elsewhere</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-red-400">-{formatCurrency(total)}</p>
          <button
            onClick={() => { setAdding(true); setAddForm(EMPTY_FORM); }}
            className="text-xs text-orange-400 hover:text-orange-300 transition-colors flex items-center gap-1 mt-1 ml-auto"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
      </div>

      {/* Add form */}
      {adding && (
        <form onSubmit={handleCreate} className="mb-4 p-4 bg-card rounded-xl border border-border/50 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-foreground/50 block mb-1">Name</label>
              <input
                type="text"
                value={addForm.name}
                onChange={e => setAddForm({ ...addForm, name: e.target.value })}
                placeholder="e.g. Dinner tab, Pending Amazon charge"
                className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
                required
              />
            </div>
            <div>
              <label className="text-xs text-foreground/50 block mb-1">Amount Owed ($)</label>
              <input
                type="number"
                step="0.01"
                value={addForm.amount}
                onChange={e => setAddForm({ ...addForm, amount: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
                required
              />
            </div>
            <div>
              <label className="text-xs text-foreground/50 block mb-1">Category</label>
              <select
                value={addForm.category}
                onChange={e => setAddForm({ ...addForm, category: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
              >
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-foreground/50 block mb-1">Due Date</label>
              <input
                type="date"
                value={addForm.due_date}
                onChange={e => setAddForm({ ...addForm, due_date: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-foreground/50 block mb-1">Notes</label>
              <input
                type="text"
                value={addForm.notes}
                onChange={e => setAddForm({ ...addForm, notes: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm hover:bg-accent-light transition-colors">
              Add Item
            </button>
            <button type="button" onClick={() => setAdding(false)} className="px-3 py-1.5 text-foreground/50 hover:text-foreground text-sm transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* List */}
      <div className="space-y-2">
        {liabilities.map(l => {
          const cat  = getCat(l.category);
          const days = daysUntil(l.due_date);
          const isOverdue = days !== null && days < 0;

          return (
            <div key={l.id} className="group p-3 rounded-xl bg-card/60 hover:bg-card-hover border border-transparent hover:border-border/30 transition-all overflow-hidden">
              {editingId === l.id ? (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                      className="col-span-2 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={editForm.amount}
                      onChange={e => setEditForm({ ...editForm, amount: e.target.value })}
                      className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
                    />
                    <select
                      value={editForm.category}
                      onChange={e => setEditForm({ ...editForm, category: e.target.value })}
                      className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
                    >
                      {CATEGORIES.map(c => (
                        <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={editForm.due_date}
                      onChange={e => setEditForm({ ...editForm, due_date: e.target.value })}
                      className="bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:border-accent"
                    />
                    <input
                      type="text"
                      placeholder="Notes"
                      value={editForm.notes}
                      onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                      className="bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleUpdate(l.id)} className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs hover:bg-accent-light transition-colors">Save</button>
                    <button onClick={() => setEditingId(null)} className="px-2 py-1.5 text-foreground/50 hover:text-foreground text-xs transition-colors">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center bg-orange-500/20 text-lg">
                      {cat.emoji}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{l.name}</p>
                      <div className="flex items-center gap-2 text-xs text-foreground/40">
                        <span>{cat.label}</span>
                        {l.notes && <span>· {l.notes}</span>}
                        {l.due_date && (
                          <span className={`flex items-center gap-0.5 ${isOverdue ? "text-red-400" : ""}`}>
                            <Clock className="w-3 h-3" />
                            {formatDate(l.due_date)}
                            {isOverdue && " (overdue!)"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-red-400">-{formatCurrency(l.amount)}</span>
                    <div className="hidden group-hover:flex items-center gap-1">
                      <button onClick={() => startEdit(l)} className="p-1 text-foreground/30 hover:text-accent transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(l.id)} className="p-1 text-foreground/30 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {liabilities.length === 0 && (
          <p className="text-center text-foreground/30 text-sm py-4">Nothing pending or owed</p>
        )}
      </div>
    </div>
  );
}
