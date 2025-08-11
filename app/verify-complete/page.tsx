"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { auth } from "@/lib/firebaseConfig";
import { applyActionCode } from "firebase/auth";

export default function VerifyCompletePage() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"pending"|"success"|"error">("pending");
  const [message, setMessage] = useState("Verifying your email…");

  useEffect(() => {
    const code = params.get("oobCode");
    const mode = params.get("mode");
    if (!code || mode !== "verifyEmail") {
      setStatus("error");
      setMessage("Invalid verification link.");
      return;
    }
    applyActionCode(auth, code)
      .then(() => {
        setStatus("success");
        setMessage("Email verified! You can close this tab and return to TennisMate.");
      })
      .catch(() => {
        setStatus("error");
        setMessage("This link is invalid or expired.");
      });
  }, [params]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl shadow p-6 text-center">
        <h1 className="text-xl mb-2">TennisMate</h1>
        <p>{message}</p>
        {status !== "pending" && (
          <button
            className="mt-6 px-4 py-2 rounded-xl border"
            onClick={() => router.push("/")}
          >
            Go to app
          </button>
        )}
      </div>
    </div>
  );
}