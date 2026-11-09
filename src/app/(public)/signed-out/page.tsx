"use client";

import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useTheme } from "@/hooks/useTheme";

export default function SignedOut() {
  const { isDark } = useTheme();
  return (
    <div className="flex flex-1 min-h-screen items-center justify-center bg-background px-4 py-12 transition-colors duration-300">
      <div className="w-full max-w-md flex flex-col gap-6 text-center">
        
        {/* Brand Header */}
        <div className="flex flex-col items-center gap-2 mb-2">
          <Link href="/" className="flex items-center gap-2.5">
            <img
              src={isDark ? "/brand-pack/Dark-Version/logo-dark.svg" : "/brand-pack/Light-Version/logo-light.svg"}
              alt="DataBoy Logo"
              className="h-10 w-auto"
            />
          </Link>
          <p className="text-xs text-muted-foreground mt-1 font-mono uppercase tracking-wider">Xenon Technologies</p>
        </div>

        {/* Signed Out Panel */}
        <Card className="shadow-lg border-border/40 bg-card">
          <CardHeader className="pb-4">
            <div className="w-12 h-12 rounded-full bg-secondary/80 flex items-center justify-center text-xl mx-auto mb-2 animate-bounce">
              🔒
            </div>
            <CardTitle className="text-lg font-black text-foreground">You Have Been Signed Out</CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-1">
              Your session has been terminated safely and your workspace is locked.
            </CardDescription>
          </CardHeader>
          
          <CardContent className="flex flex-col gap-3.5">
            <Link href="/login" className="w-full">
              <Button variant="primary" className="w-full font-bold">
                Sign In Again
              </Button>
            </Link>
            
            <Link href="/signup?role=customer" className="w-full">
              <Button variant="outline" className="w-full font-bold bg-background/50">
                Start New Assignment
              </Button>
            </Link>
          </CardContent>

          <CardFooter className="justify-center border-t border-border/20 bg-secondary/10 py-3.5">
            <span className="text-[10px] text-muted-foreground font-bold tracking-wide uppercase flex items-center gap-1.5">
              🛡️ AI-Free • Plagiarism Checked • Secure Escrow
            </span>
          </CardFooter>
        </Card>

        {/* Link back to homepage */}
        <Link href="/" className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors underline">
          Back to Homepage
        </Link>
      </div>
    </div>
  );
}
