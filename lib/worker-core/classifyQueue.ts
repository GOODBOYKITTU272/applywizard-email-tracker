import { classifyEmails, type ClassifyResult } from "@/lib/zoho/classifyEmails";

export async function classifyQueue(): Promise<ClassifyResult> {
  return classifyEmails();
}
