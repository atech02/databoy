"use client";

import React from "react";
import Link from "next/link";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function PricingPage() {
  return (
    <div className="flex flex-col flex-1 min-h-screen bg-background text-foreground">
      <PublicHeader />

      <main className="flex-1 py-6 md:py-10 lg:py-12">
        <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
          
          <div className="text-center max-w-2xl mx-auto mb-6 md:mb-10 flex flex-col gap-2">
            <Badge variant="primary" className="w-fit mx-auto font-bold uppercase tracking-widest text-[9px]">
              Fair Tiers
            </Badge>
            <h1 className="text-3xl font-black tracking-tight sm:text-5xl text-foreground mt-2 leading-tight">
              Transparent Pricing Scales
            </h1>
            <p className="text-muted-foreground text-sm max-w-md mx-auto mt-2">
              Fair rates based on requirements. All assignments are fully covered by escrow protection.
            </p>
          </div>

          <div className="flex flex-col gap-8">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
              {[
                { range: "1–4 Pages", price: "K100", label: "Short Term Papers" },
                { range: "5–7 Pages", price: "K150", label: "Medium Essays" },
                { range: "8–11 Pages", price: "K200", label: "Coursework Assignments" },
                { range: "12–15 Pages", price: "K250", label: "Term Dissertations" }
              ].map((prc, idx) => (
                <div key={idx} className="flex flex-col justify-between border border-border/40 bg-card hover:border-primary/30 p-4 sm:p-6 rounded-xl text-center shadow-sm transition-all duration-300">
                  <div>
                    <span className="text-[9px] sm:text-[10px] font-bold text-indigo-500 uppercase tracking-widest block">{prc.label}</span>
                    <h3 className="font-black text-sm sm:text-lg text-foreground mt-1.5">{prc.range}</h3>
                  </div>
                  <div className="my-4">
                    <span className="text-2xl sm:text-3xl font-extrabold text-primary">{prc.price}</span>
                  </div>
                  <div className="text-[9px] sm:text-[10px] text-muted-foreground bg-secondary/50 py-1.5 rounded font-semibold border border-border/10">
                    ZMW Escrow Hold
                  </div>
                </div>
              ))}
            </div>

            <Card className="border border-border/40 bg-card p-4 sm:p-10 shadow-md">
              <CardContent className="flex flex-col gap-6 text-sm leading-relaxed text-muted-foreground font-semibold">
                <h2 className="text-xl font-bold text-foreground">Escrow & Quality Assurances Included</h2>
                
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-semibold text-foreground/85">
                  <li className="flex gap-2.5 items-start">
                    <span className="text-emerald-500 font-bold">✓</span>
                    <div>
                      <strong className="block text-foreground text-sm">Plagiarism Screening</strong>
                      <span className="text-muted-foreground block mt-0.5">Every final draft is audited with plagiarism checking suites to verify absolute originality.</span>
                    </div>
                  </li>
                  <li className="flex gap-2.5 items-start">
                    <span className="text-emerald-500 font-bold">✓</span>
                    <div>
                      <strong className="block text-foreground text-sm">Strict AI-Free Auditing</strong>
                      <span className="text-muted-foreground block mt-0.5">We maintain zero-tolerance rules on AI generation. The output is written entirely by human writers.</span>
                    </div>
                  </li>
                  <li className="flex gap-2.5 items-start">
                    <span className="text-emerald-500 font-bold">✓</span>
                    <div>
                      <strong className="block text-foreground text-sm">Independent Peer Review</strong>
                      <span className="text-muted-foreground block mt-0.5">Your assignment draft is peer proofread and edited by a secondary academic writer to polish academic citations.</span>
                    </div>
                  </li>
                  <li className="flex gap-2.5 items-start">
                    <span className="text-emerald-500 font-bold">✓</span>
                    <div>
                      <strong className="block text-foreground text-sm">Escrow Safe Hold</strong>
                      <span className="text-muted-foreground block mt-0.5">Writers only receive payouts after you download, review, and explicitly approve the completed proofread files.</span>
                    </div>
                  </li>
                </ul>
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
