"use client";
import { useState, useMemo } from "react";

interface Props {
  totalAmount: number;
  completedSplits: number;
  onConfirm: (splitCount: number, perPersonAmount: number) => void;
  onCancel: () => void;
}

const SPLIT_OPTIONS = [2, 3, 4, 5, 6];

export default function EqualSplitPicker({
  totalAmount,
  completedSplits,
  onConfirm,
  onCancel,
}: Props) {
  const [splitCount, setSplitCount] = useState(2);

  const perPerson = useMemo(() => {
    return Math.round((totalAmount / splitCount) * 100) / 100;
  }, [totalAmount, splitCount]);

  // Handle rounding: last person pays the remainder
  const lastPersonPays = useMemo(() => {
    const others = perPerson * (splitCount - 1);
    return Math.round((totalAmount - others) * 100) / 100;
  }, [totalAmount, splitCount, perPerson]);

  const currentSplit = completedSplits + 1;
  const isLastSplit = currentSplit === splitCount;
  const thisPayment = isLastSplit ? lastPersonPays : perPerson;

  return (
    <div className="flex flex-col gap-3">
      {/* Label */}
      <div className="text-xs font-bold text-gray-500 uppercase tracking-wide">
        Αριθμός ατόμων
      </div>

      {/* Number picker */}
      <div className="flex gap-2">
        {SPLIT_OPTIONS.map((n) => (
          <button
            key={n}
            className={`flex-1 min-h-[60px] rounded-xl border-2 text-[22px] font-extrabold flex items-center justify-center transition-colors touch-btn
              ${
                splitCount === n
                  ? "border-brand bg-brand/15 text-brand"
                  : "border-gray-700 bg-gray-900 text-white"
              }`}
            onClick={() => setSplitCount(n)}
          >
            {n}
          </button>
        ))}
      </div>

      {/* Per-person display */}
      <div className="flex items-baseline justify-center gap-1.5 py-4 bg-slate-900 rounded-xl">
        <span className="text-3xl font-extrabold text-white">
          {thisPayment.toFixed(2)}€
        </span>
        <span className="text-base font-semibold text-gray-500">/ άτομο</span>
        {lastPersonPays !== perPerson && (
          <span className="text-2xs font-semibold text-amber-500">
            (τελευταίο: {lastPersonPays.toFixed(2)}€)
          </span>
        )}
      </div>

      {/* Total check */}
      <div className="text-center text-xs text-gray-600 font-semibold">
        {splitCount} x {perPerson.toFixed(2)}€ = {totalAmount.toFixed(2)}€
      </div>

      {/* Progress indicator */}
      {completedSplits > 0 && (
        <div className="flex items-center justify-center gap-1.5">
          {Array.from({ length: splitCount }).map((_, i) => (
            <div
              key={i}
              className={`h-2 flex-1 rounded-full ${
                i < completedSplits ? "bg-accent" : "bg-gray-700"
              }`}
            />
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2.5 mt-1">
        <button
          className="flex-1 py-3.5 rounded-xl border border-gray-700 bg-transparent text-gray-500 text-sm font-semibold touch-btn"
          onClick={onCancel}
        >
          Άκυρο
        </button>
        <button
          className="flex-[2] py-3.5 rounded-xl border-none bg-accent text-white text-base font-bold touch-btn"
          onClick={() => onConfirm(splitCount, thisPayment)}
        >
          Πληρωμή {currentSplit}/{splitCount}
        </button>
      </div>
    </div>
  );
}
