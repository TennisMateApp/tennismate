"use client";

import { useRouter } from "next/navigation";

export default function SignupErrorModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();

  const handleLogin = () => {
    router.push("/login");
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-lg text-center">
        <h2 className="text-xl font-semibold mb-4">Email Already Registered</h2>
        <p className="mb-6">
          An account with this email already exists. Would you like to log in instead?
        </p>
        <div className="flex justify-center gap-4">
          <button
            onClick={handleLogin}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Login
          </button>
          <button
            onClick={onClose}
            className="border border-gray-300 px-4 py-2 rounded hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
