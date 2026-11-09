"use client";

import React from "react";
import Link from "next/link";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/Card";

export default function OfflinePage() {
  const { isDark } = useTheme();
  const handleRetry = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-screen items-center justify-center bg-background px-4 py-12 transition-colors duration-300">
      <div className="w-full max-w-md">
        
        {/* Logo */}
        <div className="flex flex-col items-center gap-2 mb-8 text-center">
          <img
            src={isDark ? "/brand-pack/Dark-Version/logo-dark.svg" : "/brand-pack/Light-Version/logo-light.svg"}
            alt="DataBoy Logo"
            className="h-10 w-auto"
          />
          <p className="text-sm text-muted-foreground mt-1">Installable Desktop & Mobile PWA</p>
        </div>

        {/* Offline Card */}
        <Card className="shadow-lg border-border/40 text-center">
          <CardHeader>
            <div className="text-6xl my-4">📶</div>
            <CardTitle className="text-xl">You are currently offline</CardTitle>
            <CardDescription>
              DataBoy is running in offline PWA sandboxed mode.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground leading-relaxed">
            We cached the core static resources on your device, but active database reads, Firestore updates, and file downloads require an active internet connection. Please verify your connection and click retry.
          </CardContent>
          <CardFooter className="justify-center gap-3">
            <Button variant="outline" onClick={handleRetry}>
              Retry Connection
            </Button>
            <Link href="/">
              <Button variant="primary">Go to Landing Page</Button>
            </Link>
          </CardFooter>
        </Card>

      </div>
    </div>
  );
}
