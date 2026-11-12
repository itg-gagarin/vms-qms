// Labels shared by server and client code. No database imports here.
export type NcfStatus = "DRAFT" | "WAITING_APPROVAL" | "APPROVED" | "SENT" | "RESPONDED" | "CLOSED" | "VOID";

export const STATUS_LABEL: Record<NcfStatus, string> = {
  DRAFT: "Draft",
  WAITING_APPROVAL: "Waiting approval",
  APPROVED: "Approved · to send",
  SENT: "Sent · waiting supplier",
  RESPONDED: "Responded · to verify",
  CLOSED: "Closed",
  VOID: "Void",
};

export const GOODS_STATUS: Record<string, string> = {
  HOLD: "Ditahan / Hold – tunggu konfirmasi (24 jam)",
  FAILED: "Gagal / Failed – Retur",
  OTHER: "Lainnya",
};
