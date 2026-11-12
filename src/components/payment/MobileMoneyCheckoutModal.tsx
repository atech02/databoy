"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  paymentService,
  MobileMoneyNetwork,
  PayableTargetType,
  InitiatePaymentResponse,
} from "@/services/paymentService";

interface MobileMoneyCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignmentId: string;
  targetType?: PayableTargetType;
  assignmentTitle: string;
  amount: number;
  onSuccess: () => void;
}

export default function MobileMoneyCheckoutModal({
  isOpen,
  onClose,
  assignmentId,
  targetType = "assignment",
  assignmentTitle,
  amount,
  onSuccess,
}: MobileMoneyCheckoutModalProps) {
  const [network, setNetwork] = useState<MobileMoneyNetwork>("airtel_money");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [step, setStep] = useState<"input" | "initiating" | "polling" | "success" | "error">("input");
  const [errorMessage, setErrorMessage] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [maskedPhone, setMaskedPhone] = useState("");
  const [pollCount, setPollCount] = useState(0);
  const paymentsDisabledInStaging =
    process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === "false" ||
    process.env.NEXT_PUBLIC_APP_ENV === "staging";

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setStep("input");
      setErrorMessage("");
    if (paymentsDisabledInStaging) {
      setErrorMessage("Live and sandbox Mobile Money checkout is disabled in this staging environment.");
      return;
    }
      setReferenceId("");
      setPollCount(0);
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    }
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [isOpen]);

  // Polling effect when in polling state
  useEffect(() => {
    if (step === "polling" && referenceId) {
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await paymentService.checkPaymentStatus(referenceId);
          if (res.success && res.payment) {
            if (res.payment.status === "Successful") {
              if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
              setStep("success");
            } else if (["Failed", "Cancelled", "Expired"].includes(res.payment.status)) {
              if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
              setErrorMessage(res.payment.failureReason || "Payment was declined or timed out on your handset.");
              setStep("error");
            }
          }
        } catch (err: any) {
          console.error("[Polling error]:", err);
        }

        setPollCount((prev) => {
          // Stop after ~2 minutes (40 intervals of 3s)
          if (prev >= 40) {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            setErrorMessage("Payment verification timed out. If you approved the prompt, your assignment status will update automatically shortly.");
            setStep("error");
          }
          return prev + 1;
        });
      }, 3000);
    }

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [step, referenceId]);

  if (!isOpen) return null;

  // Phone validation check
  const cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, "");
  const isZambianPhone = /^(?:\+?260|0)?([97][567]\d{7})$/.test(cleanPhone);

  const handleInitiatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");
    if (paymentsDisabledInStaging) {
      setErrorMessage("Live and sandbox Mobile Money checkout is disabled in this staging environment.");
      return;
    }

    if (!isZambianPhone) {
      setErrorMessage("Please enter a valid Zambian mobile number (e.g. 097XXXXXXX, 096XXXXXXX, or 095XXXXXXX).");
      return;
    }

    setStep("initiating");

    try {
      const result: InitiatePaymentResponse = await paymentService.initiatePayment({
        targetType,
        targetId: assignmentId,
        ...(targetType === "research" ? { researchRequestId: assignmentId } : { assignmentId }),
        network,
        phoneNumber: cleanPhone,
      });

      if (result.success) {
        setReferenceId(result.referenceId);
        setMaskedPhone(result.maskedPhone);
        if (result.status === "Successful" || result.alreadyPaid) {
          setStep("success");
        } else {
          setStep("polling");
        }
      } else {
        setErrorMessage("Could not initiate mobile money prompt. Please try again.");
        setStep("error");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to connect to payment service.");
      setStep("error");
    }
  };

  const handleManualCheck = async () => {
    if (!referenceId) return;
    try {
      const res = await paymentService.checkPaymentStatus(referenceId);
      if (res.success && res.payment.status === "Successful") {
        setStep("success");
      } else if (res.success && ["Failed", "Cancelled", "Expired"].includes(res.payment.status)) {
        setErrorMessage(res.payment.failureReason || "Payment declined or expired.");
        setStep("error");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Error checking payment status.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-6 py-4 bg-slate-50/50 dark:bg-slate-800/30">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
              ZM
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">Mobile Money Checkout</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Zambian Mobile Networks Only</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6">
          {/* STEP 1: INPUT DETAILS */}
          {step === "input" && (
            <form onSubmit={handleInitiatePayment} className="space-y-5">
              {/* Assignment Summary Box */}
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-4 border border-slate-200/80 dark:border-slate-700/60">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Assignment
                  </span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    Escrow Protected
                  </span>
                </div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate mb-3">
                  {assignmentTitle}
                </p>
                <div className="flex items-baseline justify-between pt-2 border-t border-slate-200 dark:border-slate-700/80">
                  <span className="text-sm text-slate-600 dark:text-slate-300">Total Escrow Amount:</span>
                  <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {amount} <span className="text-sm font-semibold">ZMW</span>
                  </span>
                </div>
              </div>

              {/* Network Selection */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                  Select Mobile Money Network
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {/* Airtel Money */}
                  <button
                    type="button"
                    onClick={() => setNetwork("airtel_money")}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition ${
                      network === "airtel_money"
                        ? "border-red-500 bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-400 font-semibold shadow-sm"
                        : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-red-600 text-white flex items-center justify-center font-black text-xs mb-1.5 shadow-sm">
                      A
                    </div>
                    <span className="text-xs">Airtel Money</span>
                  </button>

                  {/* MTN Mobile Money */}
                  <button
                    type="button"
                    onClick={() => setNetwork("mtn_money")}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition ${
                      network === "mtn_money"
                        ? "border-amber-500 bg-amber-50/50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-400 font-semibold shadow-sm"
                        : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-amber-400 text-slate-900 flex items-center justify-center font-black text-xs mb-1.5 shadow-sm">
                      MTN
                    </div>
                    <span className="text-xs">MTN MoMo</span>
                  </button>

                  {/* Zamtel Kwacha */}
                  <button
                    type="button"
                    onClick={() => setNetwork("zamtel_kwacha")}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition ${
                      network === "zamtel_kwacha"
                        ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 font-semibold shadow-sm"
                        : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-black text-xs mb-1.5 shadow-sm">
                      Z
                    </div>
                    <span className="text-xs">Zamtel Kwacha</span>
                  </button>
                </div>
              </div>

              {/* Phone Input */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                  Mobile Money Account Phone Number
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-sm font-medium">
                    +260
                  </div>
                  <input
                    type="tel"
                    required
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="97 123 4567"
                    className="w-full pl-16 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium tracking-wide"
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  {network === "airtel_money" && "Airtel prefixes: 097 or 077"}
                  {network === "mtn_money" && "MTN prefixes: 096 or 076"}
                  {network === "zamtel_kwacha" && "Zamtel prefixes: 095 or 075"}
                </p>
              </div>

              {paymentsDisabledInStaging && (
                <div className="rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 p-3.5 text-xs text-blue-900 dark:text-blue-200">
                  <span className="font-bold">Staging Mode:</span> Mobile Money transactions are disabled by server and environment policy during staging review.
                </div>
              )}

              {/* Strict Security & PIN Notice Banner */}
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 p-3.5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                <svg className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="leading-relaxed">
                  <span className="font-bold">Security Notice:</span> Never share or enter your Mobile Money PIN on DataBoy or any website. DataBoy will never request your PIN. You will authorize payment strictly on your own personal mobile phone prompt.
                </div>
              </div>

              {errorMessage && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 text-xs text-red-600 dark:text-red-400">
                  {errorMessage}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={paymentsDisabledInStaging || !phoneNumber.trim()}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm transition shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <span>Send Handset Prompt</span>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </button>
              </div>
            </form>
          )}

          {/* STEP 2: INITIATING */}
          {step === "initiating" && (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-12 h-12 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
              <p className="text-base font-semibold text-slate-800 dark:text-slate-200">
                Contacting Lipila Payment Gateway...
              </p>
              <p className="text-xs text-slate-500 max-w-sm">
                Generating secure collection reference and dispatching authorization prompt to your handset.
              </p>
            </div>
          )}

          {/* STEP 3: POLLING / HANDSET APPROVAL */}
          {step === "polling" && (
            <div className="py-6 flex flex-col items-center text-center space-y-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-inner">
                  <svg className="w-8 h-8 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <span className="absolute -top-1 -right-1 flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500"></span>
                </span>
              </div>

              <div>
                <h4 className="text-lg font-bold text-slate-900 dark:text-white">
                  Handset Prompt Dispatched!
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Prompt sent to <span className="font-semibold text-slate-700 dark:text-slate-300">{maskedPhone}</span>
                </p>
              </div>

              {/* Network USSD Instructions */}
              <div className="w-full rounded-xl bg-slate-50 dark:bg-slate-800/60 p-4 border border-slate-200 dark:border-slate-700 text-left text-xs space-y-2">
                <p className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  What to do on your phone:
                </p>
                {network === "mtn_money" && (
                  <p className="text-slate-600 dark:text-slate-300">
                    Enter your PIN on the pop-up prompt. If no prompt appears within 15 seconds, dial <strong className="text-emerald-600 dark:text-emerald-400">*115#</strong>, go to <strong>My Approvals</strong>, and approve the payment of <strong>{amount} ZMW</strong>.
                  </p>
                )}
                {network === "airtel_money" && (
                  <p className="text-slate-600 dark:text-slate-300">
                    Enter your Airtel Money PIN on the USSD prompt to authorize <strong>{amount} ZMW</strong>.
                  </p>
                )}
                {network === "zamtel_kwacha" && (
                  <p className="text-slate-600 dark:text-slate-300">
                    Authorize the Zamtel Kwacha prompt on your handset with your PIN for <strong>{amount} ZMW</strong>.
                  </p>
                )}
                <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-200 dark:border-slate-700/60">
                  Reference: <span className="font-mono text-slate-600 dark:text-slate-300">{referenceId}</span>
                </div>
              </div>

              {/* Waiting status indicator */}
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Waiting for confirmation from Lipila...</span>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleManualCheck}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  I've Approved — Check Now
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: SUCCESS */}
          {step === "success" && (
            <div className="py-8 flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <div>
                <h4 className="text-xl font-bold text-slate-900 dark:text-white">
                  Payment Verified & Escrow Held!
                </h4>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 max-w-sm">
                  Your funds (<span className="font-bold">{amount} ZMW</span>) are safely held in DataBoy escrow. The assignment is now officially active and open for writer allocation.
                </p>
              </div>

              <div className="w-full rounded-xl bg-slate-50 dark:bg-slate-800/40 p-3 text-xs text-slate-500 font-mono">
                Payment Ref: {referenceId}
              </div>

              <button
                type="button"
                onClick={() => {
                  onSuccess();
                  onClose();
                }}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm transition shadow-sm"
              >
                Continue to Assignment
              </button>
            </div>
          )}

          {/* STEP 5: ERROR */}
          {step === "error" && (
            <div className="py-6 flex flex-col items-center text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400 flex items-center justify-center">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>

              <div>
                <h4 className="text-lg font-bold text-slate-900 dark:text-white">
                  Payment Incomplete
                </h4>
                <p className="text-xs text-red-600 dark:text-red-400 mt-1 max-w-sm">
                  {errorMessage || "The transaction could not be completed."}
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => setStep("input")}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs transition"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
