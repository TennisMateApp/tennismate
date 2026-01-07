"use client";

import React from "react";

type Props = {
  email: string;
  onClose: () => void;
  onGoToLogin: () => void;
};

export default function SignupErrorModal({ email, onClose, onGoToLogin }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-lg p-6 w-[92%] max-w-md space-y-4">
        <h2 className="text-lg font-semibold">Email already in use</h2>

        <p className="text-sm text-gray-700">
          An account already exists for{" "}
          <span className="font-semibold">{email || "this email address"}</span>.
          Please log in instead.
        </p>

        <div className="flex gap-3 justify-end pt-2">
          <button
            onClick={onClose}
            type="button"
            className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>

          <button
            onClick={onGoToLogin}
            type="button"
            className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700"
          >
            Go to Login
          </button>
        </div>
      </div>
    </div>
  );
}
