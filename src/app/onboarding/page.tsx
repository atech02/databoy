"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Loader } from "@/components/ui/Loader";

export default function LegacyOnboardingRouter() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace("/login");
      } else if (profile) {
        if (profile.isOnboarded) {
          router.replace("/dashboard");
        } else {
          // Silent routing to role-specific onboarding screens
          if (profile.role === "writer" || profile.writerInterest) {
            router.replace("/onboarding/writer");
          } else {
            router.replace("/onboarding/student");
          }
        }
      }
    }
  }, [user, profile, loading, router]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background">
      <Loader size="lg" />
      <span className="text-sm font-semibold tracking-wider text-muted-foreground mt-4 uppercase animate-pulse">
        Directing to Onboarding...
      </span>
    </div>
  );
}
