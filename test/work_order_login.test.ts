import { describe, expect, it, vi } from "vitest";
import type { SmsClient } from "../src/infrai_sms_client.js";
import { WorkOrderLogin } from "../src/work_order_login.js";

describe("work-order login decision", () => {
  it("moves a verified technician to follow-up and counts evidence photos", async () => {
    const sms: SmsClient = {
      requestCode: vi.fn().mockResolvedValue({}),
      verifyCode: vi.fn().mockResolvedValue({}),
    };
    const login = new WorkOrderLogin(sms);

    const result = await login.verifyAndDispatch({
      workOrderId: "WO-1842",
      technicianPhone: "+15551234567",
      code: "123456",
      photos: [
        { assetId: "before", caption: "Before repair" },
        { assetId: "after", caption: "After repair" },
      ],
    });

    expect(sms.verifyCode).toHaveBeenCalledWith(
      "+15551234567",
      "123456",
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(result).toEqual({
      workOrderId: "WO-1842",
      dispatchStatus: "technician_follow_up",
      photoCount: 2,
    });
  });

  it("rejects malformed evidence before contacting SMS", async () => {
    const sms: SmsClient = {
      requestCode: vi.fn(),
      verifyCode: vi.fn(),
    };
    const login = new WorkOrderLogin(sms);
    await expect(login.verifyAndDispatch({
      workOrderId: "WO-1842",
      technicianPhone: "5551234",
      code: "12",
      photos: [],
    })).rejects.toThrow();
    expect(sms.verifyCode).not.toHaveBeenCalled();
  });
});
