export interface RecoverQueueResult {
  checked: boolean;
  recovered: number | null;
  mode: "claim-cycle";
  note: string;
}

export async function recoverQueue(): Promise<RecoverQueueResult> {
  return {
    checked: false,
    recovered: null,
    mode: "claim-cycle",
    note: "No standalone recovery job ran. Expired processing claims are reclaimed atomically by classifyQueue through claim_zoho_email_rows.",
  };
}
