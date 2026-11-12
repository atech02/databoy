/**
 * Payment Service for DataBoy
 *
 * Communicates with backend /api/payments for Lipila Mobile Money integration.
 * Exclusively supports: Airtel Money, MTN Mobile Money, Zamtel Kwacha.
 */

import { apiClient } from "./apiClient";

export type MobileMoneyNetwork = "airtel_money" | "mtn_money" | "zamtel_kwacha";
export type PayableTargetType = "assignment" | "research";
export type LipilaPaymentStatus =
  | "Initiating"
  | "Pending"
  | "Unknown"
  | "Successful"
  | "Failed"
  | "Cancelled"
  | "Expired";

export interface InitiatePaymentPayload {
  assignmentId?: string;
  researchRequestId?: string;
  targetType?: PayableTargetType;
  targetId?: string;
  network: MobileMoneyNetwork;
  phoneNumber: string;
}

export interface InitiatePaymentResponse {
  success: boolean;
  uncertain?: boolean;
  alreadyPaid?: boolean;
  referenceId: string;
  targetType?: PayableTargetType;
  targetId?: string;
  status: LipilaPaymentStatus;
  amount: number;
  currency: "ZMW";
  network: MobileMoneyNetwork;
  maskedPhone: string;
  instructions: string;
  securityNotice: string;
}

export interface PaymentStatusResponse {
  success: boolean;
  payment: {
    referenceId: string;
    targetType?: PayableTargetType;
    targetId?: string;
    assignmentId?: string;
    researchRequestId?: string;
    status: LipilaPaymentStatus;
    uncertain?: boolean;
    amount: number;
    currency: "ZMW";
    network: MobileMoneyNetwork;
    maskedPhone: string;
    transactionId?: string;
    createdAt: string;
    completedAt?: string;
    failureReason?: string;
  };
}

export interface PaymentRecord {
  id: string;
  referenceId: string;
  assignmentId: string;
  amount: number;
  currency: "ZMW";
  network: MobileMoneyNetwork;
  maskedPhone: string;
  status: "Pending" | "Successful" | "Failed";
  createdAt: string;
  completedAt?: string;
  failureReason?: string;
}

export interface AdminCollectionsResponse {
  success: boolean;
  summary: {
    totalCollectedZMW: number;
    totalTransactions: number;
    networkCounts: {
      airtel_money: number;
      mtn_money: number;
      zamtel_kwacha: number;
    };
    statusCounts: Record<string, number>;
  };
  collections: Array<{
    id: string;
    referenceId: string;
    assignmentId: string;
    customerId: string;
    customerEmail?: string;
    amount: number;
    currency: "ZMW";
    network: MobileMoneyNetwork;
    maskedPhone: string;
    status: string;
    transactionId?: string;
    createdAt: string;
    completedAt?: string;
  }>;
}

export const paymentService = {
  /**
   * Initiates mobile money collection via Lipila
   */
  async initiatePayment(payload: InitiatePaymentPayload): Promise<InitiatePaymentResponse> {
    return apiClient.post<InitiatePaymentResponse>("/api/payments/initiate", payload);
  },

  /**
   * Polls the status of a payment by its referenceId (requires authenticated owner or admin)
   */
  async checkPaymentStatus(referenceId: string): Promise<PaymentStatusResponse> {
    return apiClient.get<PaymentStatusResponse>(`/api/payments/status/${encodeURIComponent(referenceId)}`);
  },

  /**
   * Retrieves customer payment history
   */
  async getPaymentHistory(): Promise<{ success: boolean; payments: PaymentRecord[] }> {
    return apiClient.get<{ success: boolean; payments: PaymentRecord[] }>("/api/payments/history");
  },

  /**
   * Retrieves admin payment collection overview
   */
  async getAdminCollections(): Promise<AdminCollectionsResponse> {
    return apiClient.get<AdminCollectionsResponse>("/api/payments/admin/collections");
  },
};
