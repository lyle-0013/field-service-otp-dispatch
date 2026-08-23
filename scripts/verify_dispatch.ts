import { createSmsClient } from "../src/infrai_sms_client.js";
import { WorkOrderLogin } from "../src/work_order_login.js";

const phone = process.env.TECHNICIAN_PHONE;
const code = process.env.OTP_CODE;
if (!phone || !code) throw new Error("TECHNICIAN_PHONE and OTP_CODE are required");

const login = new WorkOrderLogin(createSmsClient());
const result = await login.verifyAndDispatch({
  workOrderId: "WO-1842",
  technicianPhone: phone,
  code,
  photos: [
    { assetId: "photo-before-1842", caption: "Panel before service" },
    { assetId: "photo-after-1842", caption: "Panel after service" },
  ],
});
console.log(result);
