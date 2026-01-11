"use client";

import { useMemo, useState } from "react";

type Props = {
  isOpen: boolean;
  onSave: (age: number) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
};

export default function AgeGateModal({ isOpen, onSave, onSignOut }: Props) {
  const [ageInput, setAgeInput] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const ageNum = useMemo(() => {
    const n = Number(ageInput);
    return Number.isFinite(n) ? n : NaN;
  }, [ageInput]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setError("");

    const n = Number(ageInput);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      setError("Please enter a whole number (e.g. 29).");
      return;
    }
    if (n < 18) {
      setError("You must be 18+ to use TennisMate.");
      return;
    }
    if (n > 100) {
      setError("Please enter a valid age (18–100).");
      return;
    }

    try {
      setSaving(true);
      await onSave(n);
    } catch (e) {
      console.error(e);
      setError("Could not save your age. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-xl font-semibold">Confirm your age</h2>
        <p className="mt-2 text-sm text-gray-700">
          TennisMate is for adults only. Please enter your age to continue.
Age helps us recommend better matches by prioritising players in a similar age range and improving compatibility. You can still match with anyone, and your age won’t be publicly displayed.
        </p>

        <div className="mt-4">
          <label className="block text-sm font-medium mb-1">
            Age <span className="text-red-600">*</span>
          </label>

          <input
            type="number"
            inputMode="numeric"
            min={18}
            max={100}
            step={1}
            value={ageInput}
            onChange={(e) => {
              // allow typing freely, but keep it clean
              const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
              setAgeInput(digits);
              setError("");
            }}
            placeholder="e.g. 29"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
          />

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !ageInput || !Number.isFinite(ageNum)}
          className={`mt-5 w-full rounded-lg bg-green-600 px-4 py-2.5 font-semibold text-white hover:bg-green-700 ${
            saving ? "opacity-70" : ""
          }`}
        >
          {saving ? "Saving…" : "Save & Continue"}
        </button>

        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className="mt-3 w-full text-sm text-gray-600 underline"
          >
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
