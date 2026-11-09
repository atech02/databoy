"use client";

import React from "react";
import Link from "next/link";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function HowItWorksPage() {
  return (
    <div className="flex flex-col flex-1 min-h-screen bg-background text-foreground">
      <PublicHeader />

      <main className="flex-1 py-6 md:py-10 lg:py-12">
        <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
          
          <div className="text-center max-w-2xl mx-auto mb-6 md:mb-10 flex flex-col gap-2">
            <Badge variant="primary" className="w-fit mx-auto font-bold uppercase tracking-widest text-[9px]">
              Platform Operations
            </Badge>
            <h1 className="text-3xl font-black tracking-tight sm:text-5xl text-foreground mt-2 leading-tight">
              Our Secure Workflow
            </h1>
            <p className="text-muted-foreground text-sm max-w-md mx-auto mt-2">
              Learn how we protect your grades, budget, and academic integrity.
            </p>
          </div>

          <div className="flex flex-col gap-8">
            <Card className="border border-border/40 bg-card p-4 sm:p-10 shadow-md">
              <CardContent className="flex flex-col gap-8">
                
                <h2 className="text-xl font-bold text-foreground">Step-by-Step Security Pipeline</h2>
                
                <div className="flex flex-col gap-6">
                  {[
                    { step: "1", title: "Upload Instructions & Guidelines", desc: "Fill out our conversational form, upload assignment briefs, syllabus rubrics, or templates, and set your deadline and page targets." },
                    { step: "2", title: "Automated Escrow Calculator", desc: "Our system parses your targets to calculate a flat pricing quote. Submit your payment securely in Kwacha (ZMW) or USD to lock it in escrow." },
                    { step: "3", title: "Academic Writer Matching", desc: "A verified academic writer specializing in your exact field of study is assigned the assignment. Writers must hold active verified credentials." },
                    { step: "4", title: "Real-Time Drafting & Workspace Tracking", desc: "Monitor progress live through your workspace. Message your writer directly, upload secondary references, or request preliminary outline drafts." },
                    { step: "5", title: "Plagiarism Scan & AI Screening", desc: "Upon draft completion, the paper is audited using advanced AI screening tools and plagiarism checks to ensure 100% human authenticity." },
                    { step: "6", title: "Professional Peer Proofreading", desc: "An independent academic reviewer audits the paper against APA/Harvard guidelines and grammar checkers to perfect structural quality." },
                    { step: "7", title: "Approved Release & Download", desc: "Review the finalized deliverable. Once fully satisfied, approve release to pay the writer. Download your verified, pristine paper instantly." }
                  ].map((s, idx) => (
                    <div key={idx} className="flex gap-4 items-start border-l-2 border-primary/20 pl-6 relative pb-2">
                      <div className="absolute -left-[17px] top-0 w-8 h-8 rounded-full bg-primary text-primary-foreground font-black text-sm flex items-center justify-center shadow-md">
                        {s.step}
                      </div>
                      <div className="flex flex-col gap-1">
                        <h3 className="font-extrabold text-foreground text-sm">{s.title}</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
                      </div>
                    </div>
                  ))}
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
