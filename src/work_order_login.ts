import { createHash } from "node:crypto";
import { z } from "zod";
import type { SmsClient } from "./infrai_sms_client.js";

export const requestCodeBody = z.object({
  workOrderId: z.string().min(1),
  technicianPhone: z.string().regex(/^\+[1-9]\d{7,14}$/),
});

export const verifyCodeBody = requestCodeBody.extend({
  code: z.string().regex(/^\d{4,8}$/),
  photos: z.array(z.object({
    assetId: z.string().min(1),
    caption: z.string().min(1).max(160),
  })).max(12),
});

export type DispatchResult = {
  workOrderId: string;
  dispatchStatus: "technician_follow_up";
  photoCount: number;
};

function operationKey(action: string, workOrderId: string, phone: string): string {
  return createHash("sha256").update(`${action}:${workOrderId}:${phone}`).digest("hex");
}

export class WorkOrderLogin {
  private readonly sms: SmsClient;

  constructor(sms: SmsClient) {
    this.sms = sms;
  }

  async requestCode(input: unknown): Promise<{ workOrderId: string; dispatchStatus: "awaiting_code" }> {
    const body = requestCodeBody.parse(input);
    await this.sms.requestCode(
      body.technicianPhone,
      operationKey("request", body.workOrderId, body.technicianPhone),
    );
    return { workOrderId: body.workOrderId, dispatchStatus: "awaiting_code" };
  }

  async verifyAndDispatch(input: unknown): Promise<DispatchResult> {
    const body = verifyCodeBody.parse(input);
    await this.sms.verifyCode(
      body.technicianPhone,
      body.code,
      operationKey("verify", body.workOrderId, body.technicianPhone),
    );
    return {
      workOrderId: body.workOrderId,
      dispatchStatus: "technician_follow_up",
      photoCount: body.photos.length,
    };
  }
}
