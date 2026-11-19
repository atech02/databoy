"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { verifyPasswordResetCode, confirmPasswordReset } from "firebase/auth";
import { auth } from "@/config/firebase";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Loader } from "@/components/ui/Loader";
import { BackButton } from "@/components/ui/BackButton";

function validateStrongPassword(password: string): string | null {
  if (!password || password.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include at least one letter and one number.";
  }
  return null;
}

function mapFirebaseResetError(code?: string, defaultMsg?: string): string {
  switch (code) {
    case "auth/expired-action-code":
      return "This password-reset link has expired. Please request a new password-reset email.";
    case "auth/invalid-action-code":
      return "This password-reset link is invalid or has already been used. Password-reset links are one-time use only.";
    case "auth/user-disabled":
      return "This user account has been disabled. Please contact DataBoy support.";
    case "auth/weak-password":
      return "The new password is too weak. Please choose a stronger password with at least 8 characters.";
    default:
      return defaultMsg || "Unable to verify or complete password reset. Please request a new reset link.";
  }
}

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const { sendPasswordReset, user } = useAuth();
  const oobCode = searchParams.get("oobCode") || "";

  // Verification states: "verifying" | "valid" | "invalid" | "completed" | "request_only"
  const [step, setStep] = useState<"verifying" | "valid" | "invalid" | "completed" | "request_only">(
    oobCode ? "verifying" : "request_only"
  );
  const [verifiedEmail, setVerifiedEmail] = useState<string>("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [requestEmail, setRequestEmail] = useState(user?.email || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestSentMsg, setRequestSentMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function verifyCode() {
      if (!oobCode) {
        setStep("request_only");
        return;
      }
      setStep("verifying");
      setError(null);
      try {
        const accountEmail = await verifyPasswordResetCode(auth, oobCode);
        if (!active) return;
        setVerifiedEmail(accountEmail || "");
        setStep("valid");
      } catch (err: any) {
        if (!active) return;
        setError(mapFirebaseResetError(err?.code, err?.message));
        setStep("invalid");
      }
    }
    verifyCode();
    return () => {
      active = false;
    };
  }, [oobCode]);

  const handleConfirmNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationErr = validateStrongPassword(newPassword);
    if (validationErr) {
      setError(validationErr);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match. Please re-enter your new password.");
      return;
    }

    setSubmitting(true);
    try {
      await confirmPasswordReset(auth, oobCode, newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setStep("completed");
    } catch (err: any) {
      const mapped = mapFirebaseResetError(err?.code, err?.message);
      setError(mapped);
      if (err?.code === "auth/expired-action-code" || err?.code === "auth/invalid-action-code") {
        setStep("invalid");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestResetLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setRequestSentMsg(null);

    const cleanEmail = requestEmail.trim();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      await sendPasswordReset(cleanEmail);
      setRequestSentMsg(
        "If an account exists for that email address, a password-reset link has been sent. Please check your inbox."
      );
    } catch (err: any) {
      setError(err?.message || "Could not send password recovery link at this time.");
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "verifying") {
    return (
      <Card className="shadow-lg border-border/40 p-8 flex flex-col items-center justify-center gap-4 text-center">
        <Loader size="lg" />
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Validating secure password-reset link...
        </p>
      </Card>
    );
  }

  if (step === "completed") {
    return (
      <Card className="shadow-lg border-border/40">
        <CardHeader className="text-center">
          <div className="w-14 h-14 rounded-full bg-success/15 text-success flex items-center justify-center text-2xl mx-auto mb-2 font-bold">
            ✓
          </div>
          <CardTitle>Password Changed Successfully</CardTitle>
          <CardDescription>
            Your DataBoy account password has been updated. This reset link has now been consumed and cannot be reused.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Alert variant="success" title="Security Confirmation">
            You can now sign in using your new password.
          </Alert>
          <Link href="/login" className="w-full">
            <Button variant="primary" className="w-full font-bold">
              Return to Sign In &rarr;
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (step === "invalid") {
    return (
      <Card className="shadow-lg border-border/40">
        <CardHeader>
          <CardTitle>Reset Link Expired or Already Used</CardTitle>
          <CardDescription>
            For your security, DataBoy password-reset links expire quickly and can only be used once.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && (
            <Alert variant="error" title="Action Code Error">
              {error}
            </Alert>
          )}
          {requestSentMsg && (
            <Alert variant="success" title="Reset Link Dispatched">
              {requestSentMsg}
            </Alert>
          )}
          <form onSubmit={handleRequestResetLink} className="flex flex-col gap-4">
            <Input
              label="Enter your email to request a fresh reset link"
              type="email"
              placeholder="you@example.com"
              value={requestEmail}
              onChange={(e) => setRequestEmail(e.target.value)}
              required
            />
            <Button variant="primary" type="submit" isLoading={submitting} className="w-full font-bold">
              Send New Reset Link
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center text-xs">
          <Link href="/login" className="font-semibold text-primary hover:underline">
            &larr; Back to Sign In
          </Link>
        </CardFooter>
      </Card>
    );
  }

  if (step === "request_only") {
    return (
      <Card className="shadow-lg border-border/40">
        <CardHeader>
          <CardTitle>Reset Your Password</CardTitle>
          <CardDescription>
            Enter your email address and we will send you a verified password-reset link.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && (
            <Alert variant="error" title="Request Error">
              {error}
            </Alert>
          )}
          {requestSentMsg && (
            <Alert variant="success" title="Reset Link Dispatched">
              {requestSentMsg}
            </Alert>
          )}
          <form onSubmit={handleRequestResetLink} className="flex flex-col gap-4">
            <Input
              label="Registered Email Address"
              type="email"
              placeholder="you@example.com"
              value={requestEmail}
              onChange={(e) => setRequestEmail(e.target.value)}
              required
            />
            <Button variant="primary" type="submit" isLoading={submitting} className="w-full font-bold">
              Send Password Reset Email
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center text-xs">
          <Link href="/login" className="font-semibold text-primary hover:underline">
            &larr; Back to Sign In
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg border-border/40">
      <CardHeader>
        <CardTitle>Set New Password</CardTitle>
        <CardDescription>
          {verifiedEmail
            ? `Choose a strong new password for ${verifiedEmail}`
            : "Enter and confirm your new account password below."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleConfirmNewPassword} className="flex flex-col gap-4">
          {error && (
            <Alert variant="error" title="Password Validation">
              {error}
            </Alert>
          )}

          <Input
            label="New Password"
            type="password"
            placeholder="Minimum 8 characters (letters & numbers)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />

          <Input
            label="Confirm New Password"
            type="password"
            placeholder="Re-enter your new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Password requirements: at least 8 characters including at least one letter and one number.
          </p>

          <Button variant="primary" type="submit" isLoading={submitting} className="w-full mt-1 font-bold">
            Complete Password Reset
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center text-xs">
        <Link href="/login" className="font-semibold text-primary hover:underline">
          &larr; Cancel and return to Sign In
        </Link>
      </CardFooter>
    </Card>
  );
}

export default function ResetPasswordPage() {
  const { isDark } = useTheme();
  return (
    <div className="flex flex-1 min-h-screen items-center justify-center bg-background px-4 py-12 transition-colors duration-300 relative">
      <div className="fixed top-6 left-6 z-50">
        <BackButton fallbackUrl="/login" label="Sign In" />
      </div>

      <div className="w-full max-w-md">
        <div className="flex flex-col items-center gap-2 mb-8 text-center">
          <Link href="/" className="flex items-center gap-2">
            <img
              src={isDark ? "/brand-pack/Dark-Version/logo-dark.svg" : "/brand-pack/Light-Version/logo-light.svg"}
              alt="DataBoy Logo"
              className="h-10 w-auto"
            />
          </Link>
          <p className="text-sm text-muted-foreground mt-1">Secure Account Password Recovery</p>
        </div>

        <Suspense
          fallback={
            <Card className="shadow-lg border-border/40 p-8 flex items-center justify-center min-h-[240px]">
              <Loader size="lg" />
            </Card>
          }
        >
          <ResetPasswordContent />
        </Suspense>
      </div>
    </div>
  );
}
