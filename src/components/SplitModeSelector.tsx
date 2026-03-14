"use client";

export type SplitMode = "full" | "items" | "equal" | "custom";

interface Props {
  selected: SplitMode;
  onChange: (mode: SplitMode) => void;
}

const MODES: { key: SplitMode; label: string; icon: string }[] = [
  { key: "full", label: "Ολόκληρο", icon: "☑" },
  { key: "items", label: "Κατ' Είδος", icon: "✂" },
  { key: "equal", label: "Ισόποσο", icon: "÷" },
  { key: "custom", label: "Ποσό", icon: "€" },
];

export default function SplitModeSelector({ selected, onChange }: Props) {
  return (
    <div className="flex gap-1.5 mb-4">
      {MODES.map((m) => (
        <button
          key={m.key}
          className={`flex-1 min-h-[60px] py-2 px-1 rounded-xl border-2 flex flex-col items-center justify-center gap-1 transition-colors touch-btn
            ${
              selected === m.key
                ? "border-brand bg-brand/15 text-brand"
                : "border-gray-700 bg-gray-900 text-gray-500"
            }`}
          onClick={() => onChange(m.key)}
        >
          <span className="text-lg">{m.icon}</span>
          <span className="text-xs font-bold">{m.label}</span>
        </button>
      ))}
    </div>
  );
}
