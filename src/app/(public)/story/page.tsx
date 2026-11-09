"use client";

import React from "react";
import Link from "next/link";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function StoryPage() {
  return (
    <div className="flex flex-col flex-1 min-h-screen bg-background text-foreground">
      <PublicHeader />

      <main className="flex-1 py-6 md:py-10 lg:py-12">
        <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
          
          <div className="text-center max-w-2xl mx-auto mb-6 md:mb-10 flex flex-col gap-2">
            <Badge variant="primary" className="w-fit mx-auto font-bold uppercase tracking-widest text-[9px]">
              Origin Story
            </Badge>
            <h1 className="text-3xl font-black tracking-tight sm:text-5xl text-foreground mt-2 leading-tight">
              The Legend of DataBoy
            </h1>
            <p className="text-muted-foreground text-sm max-w-md mx-auto mt-2">
              From campus academic legend to a secure, modern academic platform.
            </p>
          </div>

          <div className="flex flex-col gap-8">
            <Card className="border border-border/40 bg-card p-4 sm:p-10 shadow-md">
              <CardContent className="flex flex-col gap-6 text-sm leading-relaxed text-muted-foreground font-semibold">
                
                <h2 className="text-xl font-bold text-foreground">Every Campus Has A DataBoy</h2>
                
                <p>
                  Across universities and colleges worldwide, there is always one student who stands out in every academic circle. The one who grasps complex assignment briefs instantly, leads seminar debates with eloquence, and helps classmates clarify administrative confusion.
                </p>
                
                <p>
                  On the campus ground, this student is often nicknamed the &quot;DataBoy.&quot;
                </p>

                <div className="bg-secondary/15 border-l-4 border-primary p-5 rounded-r-xl my-4 text-foreground/90 italic">
                  &ldquo;A DataBoy is not just smart—they are the reliable anchor who translates academic confusion into structured, clear, and high-quality success.&rdquo;
                </div>

                <h3 className="text-lg font-bold text-foreground mt-2">Connecting Tradition with Digital Integrity</h3>

                <p>
                  We built DataBoy to honor this legacy of mutual support and intellectual collaboration. Our platform transitions that time-honored tradition into a structured, highly secure PWA experience. We connect students and researchers with a verified, elite group of academic writers.
                </p>

                <p>
                  Every assignment processed on DataBoy is backed by a robust legal framework, strict Turnitin plagiarism verification, and zero-tolerance policies on AI generator tools. We maintain the human relationship and premium guidance of the classic campus DataBoy, backed by professional standards.
                </p>

                <div className="flex flex-wrap gap-2.5 mt-4">
                  <Badge variant="secondary" className="text-[10px]">Verified Writers</Badge>
                  <Badge variant="secondary" className="text-[10px]">AI-Free Guarantee</Badge>
                  <Badge variant="secondary" className="text-[10px]">Plagiarism Checked</Badge>
                  <Badge variant="secondary" className="text-[10px]">Secure Escrow</Badge>
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
