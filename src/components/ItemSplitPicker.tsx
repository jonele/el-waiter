"use client";
import { useState, useMemo } from "react";
import type { DbOrderItem } from "@/lib/waiterDb";

interface Props {
  items: DbOrderItem[];
  paidItemIds: Set<string>;
  onConfirm: (selectedIds: string[], subtotal: number) => void;
  onCancel: () => void;
}

export default function ItemSplitPicker({ items, paidItemIds, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const unpaidItems = useMemo(
    () => items.filter((it) => !paidItemIds.has(it.id)),
    [items, paidItemIds],
  );

  const subtotal = useMemo(() => {
    let sum = 0;
    selected.forEach((id) => {
      const item = unpaidItems.find((it) => it.id === id);
      if (item) sum += item.quantity * item.price;
    });
    return Math.round(sum * 100) / 100;
  }, [selected, unpaidItems]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(unpaidItems.map((it) => it.id)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
          Επιλογή ειδών
        </span>
        <div className="flex gap-1.5">
          <button
            className="px-2.5 py-1 rounded-md border border-gray-700 bg-transparent text-gray-500 text-2xs font-semibold"
            onClick={selectAll}
          >
            Όλα
          </button>
          <button
            className="px-2.5 py-1 rounded-md border border-gray-700 bg-transparent text-gray-500 text-2xs font-semibold"
            onClick={selectNone}
          >
            Κανένα
          </button>
        </div>
      </div>

      {/* Item list */}
      <div className="max-h-60 overflow-y-auto flex flex-col gap-1">
        {unpaidItems.map((item) => {
          const isSelected = selected.has(item.id);
          const lineTotal = item.quantity * item.price;
          return (
            <button
              key={item.id}
              className={`flex items-center gap-2.5 px-3 py-2.5 min-h-[60px] rounded-xl border-2 w-full text-left transition-colors touch-btn
                ${
                  isSelected
                    ? "border-brand bg-brand/10"
                    : "border-transparent bg-gray-900"
                }`}
              onClick={() => toggle(item.id)}
            >
              {/* Checkbox */}
              <span
                className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 text-sm font-bold
                  ${
                    isSelected
                      ? "border-brand bg-brand text-white"
                      : "border-gray-600 text-transparent"
                  }`}
              >
                {isSelected ? "✓" : ""}
              </span>
              {/* Qty */}
              <span className="text-sm font-bold text-brand min-w-[28px] shrink-0">
                {item.quantity}x
              </span>
              {/* Name */}
              <span className="flex-1 text-sm font-semibold text-white truncate">
                {item.name}
              </span>
              {/* Price */}
              <span className="text-sm font-bold text-white shrink-0">
                {lineTotal.toFixed(2)}€
              </span>
            </button>
          );
        })}
      </div>

      {/* Already paid items (dimmed) */}
      {paidItemIds.size > 0 && (
        <div className="flex flex-col gap-1 opacity-40">
          <span className="text-2xs text-gray-500 uppercase tracking-wide font-bold mt-1">
            Πληρωμένα
          </span>
          {items
            .filter((it) => paidItemIds.has(it.id))
            .map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-gray-900/50"
              >
                <span className="w-6 h-6 rounded-md border-2 border-green-700 bg-green-800 flex items-center justify-center shrink-0 text-sm font-bold text-green-400">
                  ✓
                </span>
                <span className="text-sm font-bold text-gray-500 min-w-[28px] shrink-0">
                  {item.quantity}x
                </span>
                <span className="flex-1 text-sm font-semibold text-gray-500 truncate line-through">
                  {item.name}
                </span>
                <span className="text-sm font-bold text-gray-500 shrink-0">
                  {(item.quantity * item.price).toFixed(2)}€
                </span>
              </div>
            ))}
        </div>
      )}

      {/* Subtotal bar */}
      <div className="flex justify-between items-center px-3.5 py-2.5 bg-slate-900 rounded-xl mt-1">
        <span className="text-xs text-gray-500 font-semibold">
          Επιλεγμένα: {selected.size} είδη
        </span>
        <span className="text-lg font-extrabold text-white">
          {subtotal.toFixed(2)}€
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-2.5 mt-1">
        <button
          className="flex-1 py-3.5 rounded-xl border border-gray-700 bg-transparent text-gray-500 text-sm font-semibold touch-btn"
          onClick={onCancel}
        >
          Άκυρο
        </button>
        <button
          className={`flex-[2] py-3.5 rounded-xl border-none bg-accent text-white text-sm font-bold touch-btn transition-opacity
            ${selected.size === 0 ? "opacity-40" : "opacity-100"}`}
          onClick={() => {
            if (selected.size > 0) onConfirm(Array.from(selected), subtotal);
          }}
          disabled={selected.size === 0}
        >
          Πληρωμή Επιλεγμένων {subtotal.toFixed(2)}€
        </button>
      </div>
    </div>
  );
}
