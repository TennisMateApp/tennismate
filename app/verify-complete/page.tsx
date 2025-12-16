"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { auth } from "@/lib/firebaseConfig";
import { applyActionCode, reload } from "firebase/auth";

export default function VerifyCompletePage() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"pending" | "success" | "error">("pending");
  const [message, setMessage] = useState("Verifying your email…");

  useEffect(() => {
    const code = params.get("oobCode");
    const mode = params.get("mode");
    const verifiedFlag = params.get("verified"); // we add this in buildVerifyUrl()

    const run = async () => {
      try {
        const hasDirectCode = mode === "verifyEmail" && !!code;
        const hasVerifiedFlag = verifiedFlag === "1";

        // If it's neither a real verify link nor an explicit verified redirect, reject it
        if (!hasDirectCode && !hasVerifiedFlag) {
          setStatus("error");
          setMessage("Invalid verification link.");
          return;
        }

        // Case A: Direct code flow (ideal)
        if (hasDirectCode && code) {
          await applyActionCode(auth, code);
        }

        // Reload current user if present, so emailVerified updates
        if (auth.currentUser) {
          await reload(auth.currentUser);
        }

        // If we can confirm verification on this device, auto-continue
        if (auth.currentUser?.emailVerified) {
          setStatus("success");
          setMessage("Email verified! Taking you into TennisMate…");
          setTimeout(() => router.replace("/home"), 900);
          return;
        }

        // Otherwise the email is verified but this browser/app isn't logged in
        setStatus("success");
        setMessage("Email verified! Please sign in to continue.");
      } catch (e) {
        console.error(e);
        setStatus("error");
        setMessage("This verification link is invalid or has expired.");
      }
    };

    run();
  }, [params, router]);

  const handleButtonClick = () => {
    if (status === "success" && auth.currentUser?.emailVerified) {
      router.replace("/home");
    } else {
      router.replace("/login");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl shadow p-6 text-center">
        <h1 className="text-xl mb-2">TennisMate</h1>
        <p>{message}</p>

        {status !== "pending" && (
          <button
            className="mt-6 px-4 py-2 rounded-xl border"
            onClick={handleButtonClick}
          >
            {auth.currentUser?.emailVerified ? "Open TennisMate" : "Go to Sign In"}
          </button>
        )}
      </div>
    </div>
  );
}
