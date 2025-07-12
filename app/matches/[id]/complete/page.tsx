"use client";

import { useRouter, useParams } from "next/navigation";
import withAuth from "@/components/withAuth"; // ✅ Import auth wrapper

function MatchCompleteStep1() {
  const router = useRouter();
  const { id: matchId } = useParams();

  const handleSelectType = (type: string) => {
    router.push(`/matches/${matchId}/complete/details?type=${type}`);
  };

  return (
    <div className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Choose Game Mode 🎾</h1>
      <div className="flex flex-col gap-4">
        {["Competitive", "Practice", "Social"].map((type) => (
          <button
            key={type}
            onClick={() => handleSelectType(type)}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700"
          >
            {type}
          </button>
        ))}
      </div>
    </div>
  );
}

export default withAuth(MatchCompleteStep1); // ✅ Wrap with auth
