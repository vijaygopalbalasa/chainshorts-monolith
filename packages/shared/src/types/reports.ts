export interface ContentBoostRequest {
  wallet: string;
  contentId: string;
  durationDays: number;
}

export interface ContentBoostReceipt {
  boostId: string;
  wallet: string;
  contentId: string;
  durationDays: number;
  amountSkr: number;
  startsAt: string;
  endsAt: string;
}
