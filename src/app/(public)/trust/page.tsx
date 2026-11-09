"use client";

import React from "react";
import Link from "next/link";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function TrustPage() {
  return (
    <div className="flex flex-col flex-1 min-h-screen bg-background text-foreground">
      <PublicHeader />

      <main className="flex-1 py-6 md:py-10 lg:py-12">
        <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
          
          <div className="text-center max-w-2xl mx-auto mb-6 md:mb-10 flex flex-col gap-2">
            <Badge variant="primary" className="w-fit mx-auto font-bold uppercase tracking-widest text-[9px]">
              Academic Integrity
            </Badge>
            <h1 className="text-3xl font-black tracking-tight sm:text-5xl text-foreground mt-2 leading-tight">
              Trust, Quality & Audits
            </h1>
            <p className="text-muted-foreground text-sm max-w-md mx-auto mt-2">
              Why DataBoy is the most reliable and trusted academic platform.
            </p>
          </div>

          <div className="flex flex-col gap-8">
            <Card className="border border-border/40 bg-card p-4 sm:p-10 shadow-md">
              <CardContent className="flex flex-col gap-6 text-sm leading-relaxed text-muted-foreground font-semibold">
                
                <h2 className="text-xl font-bold text-foreground">Our Five-Tier Quality Pillars</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-2">
                  <div className="flex flex-col gap-1 border-t border-border/20 pt-4">
                    <span className="text-xs font-black text-indigo-500 uppercase tracking-wide">1. Verified Academic Writers</span>
                    <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                      Every writer on DataBoy must submit degree certifications and university transcripts. Applications undergo structural board audits before assignment-drafting rights are granted.
                    </p>
                  </div>
                  
                  <div className="flex flex-col gap-1 border-t border-border/20 pt-4">
                    <span className="text-xs font-black text-indigo-500 uppercase tracking-wide">2. AI-Free Integrity Guarantee</span>
                    <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                      We forbid the use of generative text software. All papers are drafted word-by-word by real academic writers, prioritizing logical flow, depth, and proper domain reasoning.
                    </p>
                  </div>
                  
                  <div className="flex flex-col gap-1 border-t border-border/20 pt-4">
                    <span className="text-xs font-black text-indigo-500 uppercase tracking-wide">3. Comprehensive Plagiarism Screening</span>
                    <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                      Writers submit their files through automated Turnitin plagiarism auditing queues. Verified original logs are attached with final draft releases to guarantee unique authorship.
                    </p>
                  </div>
                  
                  <div className="flex flex-col gap-1 border-t border-border/20 pt-4">
                    <span className="text-xs font-black text-indigo-500 uppercase tracking-wide">4. Independent Proofreader Vetting</span>
                    <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                      Drafted assignments are automatically routed to a secondary peer proofreader to audit formatting frameworks (APA, Harvard, MLA) and correct spelling or flow discrepancies.
                    </p>
                  </div>
                </div>

                <div className="bg-secondary/15 p-5 rounded-xl border border-border/40 my-4 text-sm font-semibold leading-relaxed text-foreground">
                  <strong className="text-foreground block mb-1">🛡️ Secured Escrow Payout Protection</strong>
                  DataBoy completely protects your funds. Payments submitted in Kwacha (ZMW) or USD are held safely in our platform escrow contract, which releases to the writer only after you audit and explicitly accept the work.
                </div>

              </CardContent>
            </Card>

            <div className="text-center mt-4">
              <Link href="/signup?role=customer">
                <Button variant="primary" size="lg" className="font-bold px-8 shadow-lg shadow-primary/20">
                  Sign Up As Student
                </Button>
              </Link>
            </div>
          </div>

        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
