"use client";

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push("/directory"); // Redirect after login
    } catch (err: any) {
      setError("Invalid email or password.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="bg-white p-8 rounded shadow-md w-full max-w-md text-center">
        <div className="flex justify-center mb-4">
          <Image
            src="/logo.png"
            alt="TennisMate Logo"
            width={120}
            height={120}
            className="rounded-full border p-1"
          />
        </div>
        <h1 className="text-xl font-bold mb-2">Find your TennisMate</h1>
        <p className="text-sm mb-4 text-gray-600">
          Match by <strong>availability</strong>, <strong>skill</strong>, and <strong>location</strong>. Don’t miss a game — connect today!
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            className="w-full px-4 py-2 border border-gray-300 rounded"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            className="w-full px-4 py-2 border border-gray-300 rounded"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700"
          >
            Log In
          </button>
        </form>

        <div className="flex flex-col items-center mt-4 space-y-2">
          <Link
            href="/forgot-password"
            className="text-sm text-blue-600 hover:underline"
          >
            Forgot Password?
          </Link>
          <Link
            href="/signup"
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Create an account here!
          </Link>
        </div>
      </div>
    </div>
  );
}
