"use client";

import React from "react";
import Link from "next/link";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export default function Home() {
  // Premium geometric background style with rich HSL radial glow
  const heroGridStyle = {
    backgroundImage: `
      radial-gradient(circle at 50% 30%, var(--glow-color, rgba(99, 102, 241, 0.06)) 0%, transparent 65%),
      linear-gradient(to right, var(--grid-color, rgba(255, 255, 255, 0.02)) 1px, transparent 1px),
      linear-gradient(to bottom, var(--grid-color, rgba(255, 255, 255, 0.02)) 1px, transparent 1px)
    `,
    backgroundSize: "100% 100%, 40px 40px, 40px 40px",
    backgroundPosition: "center top"
  };

  return (
    <div className="flex flex-col flex-1 min-h-screen bg-background text-foreground transition-colors duration-300">
      <PublicHeader />

      {/* 1. Hero Section - Space tightened dynamically for mobile (Revision 6 & 8) */}
      <section style={heroGridStyle} className="relative overflow-hidden py-5 md:py-10 lg:py-14 border-b border-border/40 bg-card">
        <div className="container mx-auto px-4 sm:px-6 flex flex-col items-center text-center max-w-4xl relative z-10">
          <Badge variant="primary" className="mb-2 md:mb-3 py-1 px-4 bg-primary/10 border-primary/20 text-primary font-bold uppercase tracking-wider text-[10px]">
            ✨ Powered by Xenon Technologies
          </Badge>
          
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-foreground leading-tight mt-1">
            Verified Academic Support<br/>
            <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">For Students And Researchers.</span>
          </h1>
          
          <p className="mt-2.5 md:mt-3 text-xs sm:text-base md:text-lg text-muted-foreground max-w-2xl leading-relaxed font-semibold">
            Submit your assignment guidelines, match with vetted academic writers, track writing progress in real time, and receive proofread, plagiarism-free deliverables.
          </p>

          <div className="mt-3 md:mt-5 flex flex-col items-center gap-2">
            <span className="text-[9px] sm:text-xs font-bold text-indigo-500 tracking-wider uppercase bg-indigo-500/5 border border-indigo-500/10 px-2.5 py-1.5 rounded-full">
              AI-Free Writing • Plagiarism-Free Delivery • Professional Academic Standards
            </span>
          </div>

          {/* Singular Centered Student Acquisition CTA (Change 1) */}
          <div className="mt-4 md:mt-8 flex justify-center w-full max-w-xs sm:max-w-md mx-auto">
            <Link href="/signup?role=customer" className="w-full sm:w-auto">
              <Button variant="primary" size="lg" className="w-full font-bold px-10 py-3.5 shadow-lg shadow-primary/20 text-xs sm:text-sm">
                Sign Up As Student
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* 2. Trust Badges (Trust Strip) - Padding compressed (Revision 8) */}
      <section className="py-2.5 md:py-4 bg-muted/20 border-b border-border/40">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[10px] sm:text-xs font-bold text-foreground/95">
            <div className="flex items-center gap-1 bg-background px-2.5 py-1 rounded-lg border border-border/30 shadow-sm">
              <span className="text-emerald-500 text-xs">✓</span> Verified Academics
            </div>
            <div className="flex items-center gap-1 bg-background px-2.5 py-1 rounded-lg border border-border/30 shadow-sm">
              <span className="text-emerald-500 text-xs">✓</span> Human-Written Work
            </div>
            <div className="flex items-center gap-1 bg-background px-2.5 py-1 rounded-lg border border-border/30 shadow-sm">
              <span className="text-emerald-500 text-xs">✓</span> Plagiarism Screening
            </div>
            <div className="flex items-center gap-1 bg-background px-2.5 py-1 rounded-lg border border-border/30 shadow-sm">
              <span className="text-emerald-500 text-xs">✓</span> Secure Escrow Hold
            </div>
          </div>
        </div>
      </section>

      {/* 3. How It Works Summary - Spacing compressed (Revision 8) */}
      <section className="py-3 md:py-10 border-b border-border/40 bg-background">
        <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
          <div className="text-center max-w-2xl mx-auto mb-4 md:mb-8 flex flex-col gap-1">
            <Badge variant="secondary" className="w-fit mx-auto font-bold uppercase tracking-widest text-[8px]">Simplified Flow</Badge>
            <h2 className="text-xl md:text-2xl font-black text-foreground mt-1">How It Works</h2>
          </div>

          {/* Sequential Stack: Stacked vertically on mobile, horizontal row on desktop */}
          <div className="flex flex-col sm:flex-row items-center sm:items-stretch justify-between gap-2 sm:gap-4 mb-4 md:mb-6">
            {[
              { step: "1", title: "Upload Instructions", desc: "Share your briefs & rubrics." },
              { step: "2", title: "Escrow Hold", desc: "ZMW held safely in escrow." },
              { step: "3", title: "Writer Assigned", desc: "Vetted writer drafts paper." },
              { step: "4", title: "Proofreading & Delivery", desc: "AI audit & download." }
            ].map((s, idx) => (
              <React.Fragment key={idx}>
                <div className="w-full sm:flex-1 bg-card border border-border/40 p-3 md:p-4 rounded-xl text-center flex flex-col gap-1 shadow-sm">
                  <div className="w-6.5 h-6.5 rounded-full bg-primary text-primary-foreground font-black text-[11px] flex items-center justify-center mx-auto shadow-sm">
                    {s.step}
                  </div>
                  <h3 className="font-bold text-xs sm:text-sm text-foreground mt-1">{s.title}</h3>
                  <p className="text-[11px] sm:text-sm text-muted-foreground leading-snug">{s.desc}</p>
                </div>
                
                {/* Arrow indicator between steps on mobile */}
                {idx < 3 && (
                  <div className="block sm:hidden text-primary/60 text-xs font-black my-0.5">
                    ↓
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          <div className="text-center">
            <Link href="/how-it-works">
              <Button variant="outline" size="sm" className="font-bold text-[10px] sm:text-xs">
                Explore Detailed Security Pipeline
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* 4. Pricing Preview - Spacing compressed (Revision 8) */}
      <section className="py-3 md:py-10 border-b border-border/40 bg-card">
        <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
          <div className="text-center max-w-2xl mx-auto mb-4 md:mb-8 flex flex-col gap-1">
            <Badge variant="secondary" className="w-fit mx-auto font-bold uppercase tracking-widest text-[8px]">Fair Rates</Badge>
            <h2 className="text-xl md:text-2xl font-black text-foreground mt-1">Pricing Preview</h2>
          </div>

          <Card className="border border-border/45 bg-card p-3.5 md:p-5 rounded-xl flex flex-col sm:flex-row gap-4 items-center justify-between shadow-sm max-w-2xl mx-auto">
            <div className="text-center sm:text-left flex flex-col gap-0.5">
              <span className="text-xs sm:text-sm font-extrabold text-foreground">Escrow Pricing Starts from K100</span>
              <p className="text-[11px] sm:text-sm text-muted-foreground max-w-md leading-relaxed">
                Transparent page range scales based on academic requirements. Zero-risk escrow protection is standard for every assignment.
              </p>
            </div>
            <Link href="/pricing" className="shrink-0 w-full sm:w-auto">
              <Button variant="primary" size="sm" className="w-full font-bold text-xs">
                View Pricing Tiers
              </Button>
            </Link>
          </Card>
        </div>
      </section>

      {/* 5. DataBoy Story - Spacing compressed (Revision 8) */}
      <section className="py-3 md:py-10 border-b border-border/40 bg-background relative overflow-hidden">
        <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
          <div className="bg-card/45 backdrop-blur-md rounded-2xl border border-border/40 p-4 md:p-8 shadow-md grid grid-cols-1 md:grid-cols-12 gap-3.5 md:gap-6 items-center">
            <div className="md:col-span-8 flex flex-col gap-1">
              <Badge variant="secondary" className="w-fit font-bold uppercase tracking-widest text-[8px]">Brand Story</Badge>
              <h2 className="text-lg md:text-2xl font-black text-foreground mt-1">Every Campus Has A DataBoy.</h2>
              <p className="text-[11px] sm:text-sm text-muted-foreground leading-relaxed">
                Across universities, a &quot;DataBoy&quot; is the legendary student everyone turns to for academic help—the one who grasps instructions and helps peers succeed. We bring that tradition into the digital age with vetted academic writers and strict plagiarism checks.
              </p>
            </div>
            <div className="md:col-span-4 flex justify-end">
              <Link href="/story" className="w-full md:w-auto">
                <Button variant="outline" size="sm" className="w-full font-bold text-xs">
                  Read Our Origin Story
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Trust & Quality Highlight - Spacing compressed (Revision 8) */}
      <section className="py-3 md:py-10 border-b border-border/40 bg-card">
        <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
          <div className="bg-card border border-border/40 p-4 md:p-6 rounded-2xl flex flex-col sm:flex-row gap-3.5 md:gap-6 items-center justify-between shadow-sm">
            <div className="flex flex-col gap-1">
              <Badge variant="secondary" className="w-fit font-bold uppercase tracking-widest text-[8px]">Quality Control</Badge>
              <h2 className="text-base md:text-xl font-black text-foreground mt-1">Our Academic Integrity Guarantee</h2>
              <p className="text-[11px] sm:text-sm text-muted-foreground leading-relaxed max-w-lg">
                We maintain an absolute zero-tolerance policy against AI generation. All files run through advanced plagiarism checkers and secondary peer reviews before being released.
              </p>
            </div>
            <Link href="/trust" className="shrink-0 w-full sm:w-auto">
              <Button variant="outline" size="sm" className="w-full font-bold text-xs">
                Vetting Details
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* 7. Final Student CTA Section with subtle Writer Teaser (Revision 1, 6, 8, 9) */}
      <section className="py-3.5 md:py-10 bg-background">
        <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
          <Card className="bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent border-primary/20 shadow-md text-center p-4 md:p-8 relative overflow-hidden">
            <CardContent className="flex flex-col items-center gap-2.5 md:gap-4 relative z-10">
              <div className="hidden md:block text-4xl">🎓</div>
              <Badge variant="secondary" className="w-fit font-bold uppercase tracking-widest text-[8px]">Get Started</Badge>
              <h2 className="text-base md:text-2xl font-black text-foreground tracking-tight">Ready to Secure Your Academic Success?</h2>
              <p className="text-[11px] md:text-sm text-muted-foreground max-w-lg leading-relaxed">
                Join thousands of students who match with vetted academic writers, secure their transactions in zero-risk escrow, and receive Turnitin plagiarism-screened, high-quality assignments.
              </p>
              <Link href="/signup?role=customer" className="mt-1">
                <Button variant="primary" size="sm" className="font-bold py-2.5 px-6 shadow-md text-[10px] md:text-xs uppercase tracking-wider">
                  Sign Up As Student
                </Button>
              </Link>
              
              {/* Subtle secondary writer teaser link (Revision 1 & 9) */}
              <p className="text-[10px] text-muted-foreground mt-2">
                Are you an academic expert? Learn how to{" "}
                <Link href="/become-writer" className="text-primary hover:underline font-bold transition-colors">
                  Become A Writer →
                </Link>
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
