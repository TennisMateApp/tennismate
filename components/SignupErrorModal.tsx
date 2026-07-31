"use client";

import React from "react";

type Props = {
  email: string;
  onClose: () => void;
  onGoToLogin: () => void;
  onResetPassword: () => void;
};

export default function SignupErrorModal({ email, onClose, onGoToLogin, onResetPassword }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signup-email-exists-title"
        aria-describedby="signup-email-exists-description"
        className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-lg"
      >
        <h2 id="signup-email-exists-title" className="text-lg font-semibold">Email already in use</h2>

        <p id="signup-email-exists-description" className="text-sm text-gray-700">
          An account already exists for{" "}
          <span className="font-semibold">{email || "this email address"}</span>.
          Sign in or reset your password.
        </p>

        <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
          <button
            onClick={onClose}
            type="button"
            className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>

          <button
            onClick={onResetPassword}
            type="button"
            className="px-4 py-2 rounded-md border border-green-700 text-green-800 hover:bg-green-50"
          >
            Reset Password
          </button>

          <button
            onClick={onGoToLogin}
            type="button"
            autoFocus
            className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700"
          >
            Sign In
          </button>
        </div>
      </div>
    </div>
  );
}
