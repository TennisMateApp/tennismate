"use client";

import { useMemo, useState } from "react";

type Props = {
  isOpen: boolean;
  onSave: (birthYear: number) => Promise<void> | void; // ✅ birthYear
  onSignOut?: () => Promise<void> | void;
};

export default function AgeGateModal({ isOpen, onSave, onSignOut }: Props) {
  const [birthYearInput, setBirthYearInput] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const birthYearNum = useMemo(() => {
    const n = Number(birthYearInput);
    return Number.isFinite(n) ? n : NaN;
  }, [birthYearInput]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setError("");

    const currentYear = new Date().getFullYear();
    const by = Number(birthYearInput);

    if (!Number.isFinite(by) || !Number.isInteger(by)) {
      setError("Please enter a valid 4-digit year (e.g. 1994).");
      return;
    }
    if (by < 1900 || by > currentYear) {
      setError(`Please enter a valid birth year (1900–${currentYear}).`);
      return;
    }

    const age = currentYear - by;

    if (age < 18) {
      setError("You must be 18+ to use TennisMate.");
      return;
    }
    if (age > 110) {
      setError("Please enter a valid birth year.");
      return;
    }

    try {
      setSaving(true);
      await onSave(by); // ✅ pass birthYear
    } catch (e) {
      console.error(e);
      setError("Could not save your birth year. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-xl font-semibold">Confirm your age</h2>
        <p className="mt-2 text-sm text-gray-700">
          TennisMate is for adults only. Please enter your birth year to continue.
          Birth year helps improve match recommendations. It won’t be publicly displayed.
        </p>

        <div className="mt-4">
          <label className="block text-sm font-medium mb-1">
            Birth Year <span className="text-red-600">*</span>
          </label>

          <input
            type="text"
            inputMode="numeric"
            value={birthYearInput}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
              setBirthYearInput(digits);
              setError("");
            }}
            placeholder="e.g. 1994"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
          />

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving || birthYearInput.length !== 4 || !Number.isFinite(birthYearNum)}
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
