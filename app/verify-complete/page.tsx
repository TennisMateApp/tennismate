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

    if (!code || mode !== "verifyEmail") {
      setStatus("error");
      setMessage("Invalid verification link.");
      return;
    }

    const run = async () => {
      try {
        // 1) Apply the verification code
        await applyActionCode(auth, code);

        // 2) If this device has a logged-in user, refresh them
        if (auth.currentUser) {
          try {
            await reload(auth.currentUser);
          } catch (e) {
            console.warn("Could not reload currentUser after verification", e);
          }
        }

        setStatus("success");

        if (auth.currentUser) {
          // ✅ Same device & still signed in → auto-continue into the app
          setMessage("Email verified! Taking you into TennisMate…");
          setTimeout(() => {
            router.replace("/home"); // or wherever your main screen is
          }, 1200);
        } else {
          // ✅ Different device / not logged in here
          setMessage("Email verified! You can now sign in to TennisMate.");
        }
      } catch (e) {
        console.error(e);
        setStatus("error");
        setMessage("This link is invalid or has expired.");
      }
    };

    run();
  }, [params, router]);

  const handleButtonClick = () => {
    if (status === "success" && auth.currentUser) {
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
            {auth.currentUser ? "Open TennisMate" : "Go to Sign In"}
          </button>
        )}
      </div>
    </div>
  );
}
