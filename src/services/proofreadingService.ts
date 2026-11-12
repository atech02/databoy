import { apiClient } from "./apiClient";

export interface ProofreadingTaskItem {
  id: string;
  assignmentId: string;
  title: string;
  subject?: string;
  wordCount?: number;
  draftUrl: string;
  originalWriterId: string;
  originalWriterName: string;
  budget: number;
  proofreaderEarning: number;
  status: "unassigned" | "claimed" | "submitted" | "approved" | "returned";
  proofreaderId: string | null;
  proofreaderName: string | null;
  proofreaderSubmissionUrl: string | null;
  feedbackNotes?: string;
  claimedAt?: string;
  submittedAt?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const proofreadingService = {
  /**
   * Fetch open proofreading tasks available for qualified proofreaders
   */
  async getPool(): Promise<ProofreadingTaskItem[]> {
    const res = await apiClient.get<{ tasks: ProofreadingTaskItem[] }>("/api/proofreading/pool");
    return res.tasks || [];
  },

  /**
   * Claim an open proofreading task
   */
  async claimTask(taskId: string): Promise<ProofreadingTaskItem> {
    const res = await apiClient.post<{ message: string; task: ProofreadingTaskItem }>(
      `/api/proofreading/${taskId}/claim`
    );
    return res.task;
  },

  /**
   * Submit completed proofreading draft and notes
   */
  async submitTask(taskId: string, submissionUrl: string, notes?: string): Promise<ProofreadingTaskItem> {
    const res = await apiClient.post<{ message: string; task: ProofreadingTaskItem }>(
      `/api/proofreading/${taskId}/submit`,
      { submissionUrl, notes }
    );
    return res.task;
  },

  /**
   * Admin approves proofread document and triggers payout
   */
  async approveTask(taskId: string): Promise<ProofreadingTaskItem> {
    const res = await apiClient.post<{ message: string; task: ProofreadingTaskItem }>(
      `/api/proofreading/${taskId}/approve`
    );
    return res.task;
  },

  /**
   * Admin returns task for corrections
   */
  async returnTask(taskId: string, feedback: string): Promise<ProofreadingTaskItem> {
    const res = await apiClient.post<{ message: string; task: ProofreadingTaskItem }>(
      `/api/proofreading/${taskId}/return`,
      { feedback }
    );
    return res.task;
  },
};
