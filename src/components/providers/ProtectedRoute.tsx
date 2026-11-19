"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { FullPageLoader } from "@/components/ui/Loader";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[]; // Scaffolding for role checks
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles
}) => {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  console.log(`[ProtectedRoute] Render check. loading: ${loading}, user: ${user?.uid || "null"}, profile: ${profile?.uid || "null"}`);

  useEffect(() => {
    console.log(`[ProtectedRoute] Effect run. loading: ${loading}, user: ${user?.uid || "null"}, profile: ${profile?.uid || "null"}`);
    if (!loading) {
      if (!user) {
        console.log("[ProtectedRoute] No user found. Redirecting to /");
        router.replace("/");
      } else if (profile) {
        console.log(`[ProtectedRoute] Role resolution check. Profile role: ${profile.role}, isOnboarded: ${profile.isOnboarded}`);
        
        // 1. Bypass onboarding loops for Admin accounts
        const needsOnboarding = !profile.isOnboarded && profile.role !== "admin";
        
        if (needsOnboarding) {
          if (profile.role === "writer" || profile.writerInterest) {
            console.log("[ProtectedRoute] Onboarding incomplete for writer applicant. Redirecting to /onboarding/writer");
            router.replace("/onboarding/writer");
          } else {
            console.log("[ProtectedRoute] Onboarding incomplete for student. Redirecting to /onboarding/student");
            router.replace("/onboarding/student");
          }
        } 
        // 2. Strict allowedRoles validation checks
        else if (allowedRoles && !allowedRoles.includes(profile.role)) {
          console.log(`[ProtectedRoute] Access Denied: role "${profile.role}" is unauthorized. Redirecting to /dashboard`);
          router.replace("/dashboard");
        } else {
          console.log("[ProtectedRoute] Access granted. Safe to mount children.");
        }
      } else {
        console.log("[ProtectedRoute] User is authenticated but profile is null (possibly due to fetch failure).");
      }
    }
  }, [user, profile, loading, router, allowedRoles]);

  if (loading) {
    console.log("[ProtectedRoute] Rendering FullPageLoader due to loading = true");
    return <FullPageLoader />;
  }

  if (!user) {
    console.log("[ProtectedRoute] Rendering FullPageLoader due to user = null during redirection");
    return <FullPageLoader />; // Keep spinner active during redirection
  }

  if (profile) {
    const needsOnboarding = !profile.isOnboarded && profile.role !== "admin";
    if (needsOnboarding) {
      return <FullPageLoader />; // Guard layout mount during redirection to onboarding
    }
    if (allowedRoles && !allowedRoles.includes(profile.role)) {
      return <FullPageLoader />; // Guard layout mount during access-denied redirection
    }
  } else {
    // Keep spinner active while fetching user profile
    return <FullPageLoader />;
  }

  return <>{children}</>;
};
