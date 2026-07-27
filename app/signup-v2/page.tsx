import { redirect } from "next/navigation";
import { Suspense } from "react";

import OnboardingV2Flow from "@/components/onboarding-v2/OnboardingV2Flow";

function onboardingV2Enabled() {
  return process.env.ONBOARDING_V2_ENABLED === "true";
}

export default function SignupV2Page() {
  if (!onboardingV2Enabled()) redirect("/signup");
  return (
    <Suspense fallback={null}>
      <OnboardingV2Flow />
    </Suspense>
  );
}
