"use client";
import React from "react";
import Link from "next/link";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function BecomeWriterPage() {
  const heroGridStyle = {
    backgroundImage: `
      radial-gradient(circle at 50% 30%, rgba(99, 102, 241, 0.08) 0%, transparent 65%),
      linear-gradient(to right, rgba(255, 255, 255, 0.01) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255, 255, 255, 0.01) 1px, transparent 1px)
    `,
    backgroundSize: "100% 100%, 40px 40px, 40px 40px",
    backgroundPosition: "center top"
  };

  return (
    <div className="flex flex-col flex-1 min-h-screen bg-background text-foreground">
      <PublicHeader />

      <main className="flex-1">
        {/* 1. Writer Hero Section */}
        <section style={heroGridStyle} className="relative overflow-hidden py-10 md:py-16 border-b border-border/40 bg-background text-center">
          <div className="container mx-auto px-4 sm:px-6 max-w-4xl relative z-10">
            <Badge variant="primary" className="mb-3 py-1 px-4 bg-primary/10 border-primary/20 text-primary font-bold uppercase tracking-wider text-[10px]">
              ✍️ Elite Academic Writer Community
            </Badge>

            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-foreground leading-tight mt-2">
              Write for DataBoy.<br/>
              <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
                Earn on Your Own Schedule.
              </span>
            </h1>

            <p className="mt-4 text-xs sm:text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed font-semibold">
              Are you a qualified academic writer, researcher, or proofreader? Join the most trusted platform connecting academic experts with students seeking peer reviews, proofreading, and guidelines assistance.
            </p>

            <div className="mt-6">
              <Link href="/signup?role=writer">
                <Button variant="primary" size="lg" className="font-bold px-10 py-3.5 shadow-lg shadow-primary/20 text-xs sm:text-sm uppercase tracking-wider">
                  Apply As Academic Writer
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* 2. Key Platform Statistics Strip */}
        <section className="py-4 bg-muted/20 border-b border-border/40">
          <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
            <div className="grid grid-cols-3 gap-2 sm:gap-6 text-center">
              <div className="bg-background/80 p-2 sm:p-4 rounded-xl border border-border/30 shadow-sm">
                <span className="block text-sm sm:text-xl font-black text-indigo-500 leading-none">K100+</span>
                <span className="text-[9px] sm:text-[11px] font-bold text-muted-foreground uppercase tracking-wider mt-1 block">Starting per Page</span>
              </div>
              <div className="bg-background/80 p-2 sm:p-4 rounded-xl border border-border/30 shadow-sm">
                <span className="block text-sm sm:text-xl font-black text-indigo-500 leading-none">100% Secure</span>
                <span className="text-[9px] sm:text-[11px] font-bold text-muted-foreground uppercase tracking-wider mt-1 block">Escrow Payments</span>
              </div>
              <div className="bg-background/80 p-2 sm:p-4 rounded-xl border border-border/30 shadow-sm">
                <span className="block text-sm sm:text-xl font-black text-indigo-500 leading-none">Flexible</span>
                <span className="text-[9px] sm:text-[11px] font-bold text-muted-foreground uppercase tracking-wider mt-1 block">Remote Schedule</span>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Core Requirements & Verification Expectations */}
        <section className="py-6 md:py-12 border-b border-border/40 bg-muted/5">
          <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
            <div className="text-center max-w-2xl mx-auto mb-6 md:mb-10 flex flex-col gap-1">
              <Badge variant="secondary" className="w-fit mx-auto font-bold uppercase tracking-widest text-[8px]">Strict Standards</Badge>
              <h2 className="text-xl md:text-3xl font-black text-foreground mt-1">Writer Requirements & Vetting</h2>
              <p className="text-[11px] sm:text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                We maintain an absolute zero-tolerance policy against AI generation and plagiarism. All applicants undergo a comprehensive credentials audit.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="border border-border/40 bg-card p-4 sm:p-6 rounded-2xl shadow-sm">
                <CardContent className="p-0 flex flex-col gap-3">
                  <h3 className="text-sm sm:text-base font-extrabold text-foreground flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center font-bold text-xs">🎓</span>
                    Academic Credentials
                  </h3>
                  <ul className="text-xs sm:text-sm font-semibold text-muted-foreground flex flex-col gap-2 list-disc pl-4 leading-relaxed">
                    <li>Minimum of an active Bachelor’s degree, Master’s, or PhD from a recognized higher learning institution.</li>
                    <li>Verified certificate copies and official transcript validations are mandatory during application.</li>
                    <li>Strong command of formal academic citation styles (APA, Harvard, MLA, Chicago, IEEE).</li>
                  </ul>
                </CardContent>
              </Card>

              <Card className="border border-border/40 bg-card p-4 sm:p-6 rounded-2xl shadow-sm">
                <CardContent className="p-0 flex flex-col gap-3">
                  <h3 className="text-sm sm:text-base font-extrabold text-foreground flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center font-bold text-xs">🔍</span>
                    Verification Expectations
                  </h3>
                  <ul className="text-xs sm:text-sm font-semibold text-muted-foreground flex flex-col gap-2 list-disc pl-4 leading-relaxed">
                    <li>**Government ID Check**: Verification of legal name and address to prevent credentials spoofing.</li>
                    <li>**Sample Writing Audit**: Evaluation of original, human-written sample papers across academic domains.</li>
                    <li>**AI & Plagiarism Screening**: Strict pre-screening of all writing samples via commercial scanners.</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* 4. Earnings & Writer Benefits */}
        <section className="py-6 md:py-12 border-b border-border/40 bg-background">
          <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
            <div className="text-center max-w-2xl mx-auto mb-6 md:mb-10 flex flex-col gap-1">
              <Badge variant="secondary" className="w-fit mx-auto font-bold uppercase tracking-widest text-[8px]">Writer Benefits</Badge>
              <h2 className="text-xl md:text-3xl font-black text-foreground mt-1">Why Writers Excel on DataBoy</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-card border border-border/40 p-4 rounded-xl shadow-sm text-center flex flex-col gap-2">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground font-black text-sm flex items-center justify-center mx-auto shadow-sm">🛡️</div>
                <h3 className="font-bold text-xs sm:text-sm text-foreground">Escrow Payout Safety</h3>
                <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
                  Every assignment requires the student to load funds into a secure escrow hold before you type a single word. Guaranteed payout upon verification.
                </p>
              </div>

              <div className="bg-card border border-border/40 p-4 rounded-xl shadow-sm text-center flex flex-col gap-2">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground font-black text-sm flex items-center justify-center mx-auto shadow-sm">📈</div>
                <h3 className="font-bold text-xs sm:text-sm text-foreground">Continuous Queue</h3>
                <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
                  Gain continuous access to a rich pipeline of verified student assignment briefs, research guidelines, and proofreading tasks at all times.
                </p>
              </div>

              <div className="bg-card border border-border/40 p-4 rounded-xl shadow-sm text-center flex flex-col gap-2">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground font-black text-sm flex items-center justify-center mx-auto shadow-sm">💼</div>
                <h3 className="font-bold text-xs sm:text-sm text-foreground">Complete Flexibility</h3>
                <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
                  Control your workload entirely. Accept only assignments that interest you, manage your workspace remotely, and set your own hours.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 5. Final CTA Card */}
        <section className="py-8 bg-background">
          <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
            <Card className="bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent border-primary/20 shadow-md text-center p-6 md:p-10 relative overflow-hidden">
              <CardContent className="flex flex-col items-center gap-3 relative z-10">
                <Badge variant="secondary" className="w-fit font-bold uppercase tracking-widest text-[8px]">Start Application</Badge>
                <h2 className="text-base sm:text-2xl font-black text-foreground tracking-tight">Apply to Become a Vetted Writer Today</h2>
                <p className="text-[11px] sm:text-sm text-muted-foreground max-w-lg leading-relaxed">
                  Ready to translate your academic credentials into continuous remote earning? Complete your application profile, upload your credentials, and start matched assignments today.
                </p>
                <Link href="/signup?role=writer" className="mt-2">
                  <Button variant="primary" size="lg" className="font-bold py-2.5 px-8 shadow-md text-xs uppercase tracking-wider bg-gradient-to-r from-indigo-600 to-purple-600 border-none text-white hover:from-indigo-500 hover:to-purple-500">
                    Register As Academic Writer
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
