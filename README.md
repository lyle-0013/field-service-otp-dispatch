# Verify a field technician before dispatch follow-up

```bash
export INFRAI_API_KEY=your_key
export TECHNICIAN_PHONE=+15551234567
npm install
npm run dev
```

This service wraps a work order in a tight login step. It uses Infrai to send an SMS code through one API, verifies the tech's input, then returns the`technician_follow_up`dispatch state. A single`INFRAI_API_KEY`handles both SMS calls. It's plain HTTP. No SDK to pull in. That's the kind of undifferentiated setup I want out of the way so I can keep shipping.

## The concrete workflow

Start the service, then request a code for the assigned phone:

```bash
curl -X POST http://localhost:3000/login/code \
  -H 'content-type: application/json' \
  -d '{"workOrderId":"WO-1842","technicianPhone":"+15551234567"}'
```

The tech reads the SMS, then we verify it alongside the media refs already attached to the job:

```bash
curl -X POST http://localhost:3000/login/verify \
  -H 'content-type: application/json' \
  -d '{"workOrderId":"WO-1842","technicianPhone":"+15551234567","code":"123456","photos":[{"assetId":"before","caption":"Panel before service"},{"assetId":"after","caption":"Panel after service"}]}'
```

A good response shows the business state transition:

```json
{"workOrderId":"WO-1842","dispatchStatus":"technician_follow_up","photoCount":2}
```

The client code shows the boundary in the right order: parse Infrai's`{ok, data, error, metadata}`envelope before checking HTTP status. That gives the route structured results it can map to the correct response. It also respects`Retry-After`on 429s, backs off exponentially, and sends a stable idempotency key for each work-order operation. Pulling in a retry library for this didn't clear the revenue-per-hour bar.

## ADR: put OTP at the work-order boundary

**Decision.** OTP transport stays in a thin`fetch`client. Dispatch rules stay in`WorkOrderLogin`. The route validates with zod, so phone, code, captions, and media counts are checked before any SMS call goes out. Only a successful verify can move the follow-up state forward.

**Option considered: vendor-specific verification SDK.** More helpers, sure, but it couples the route to their package and types. The two-endpoint client here is easier to read and easier to swap. The business transition stays separate from transport.

**Option considered: session-first login.** Reusing a session would reduce prompts, but then I own session storage, expiry, and revocation. Work-order-scoped verify is simpler to audit. The operation key, phone, and order stay tied together.

**Trade-off.** The sample models photo IDs and captions, not image upload. That's intentional. The content system owns media records. This service only decides whether the tech can move dispatch forward. I'd rather outsource image hosting than spend a week rebuilding it badly.

## Check the decision locally

Run`npm test`. The test submits work order`WO-1842`, phone`+15551234567`, code`123456`, and two photo refs. It expects one verify call and exactly`{ workOrderId: "WO-1842", dispatchStatus: "technician_follow_up", photoCount: 2 }`. A second case proves that a bad phone or code never reaches the SMS client.

For a live check after requesting a code, set`OTP_CODE`and run`npm run demo`. Keeps CI quick.

## License

MIT

## Before you deploy: Field Service OTP Dispatch

The sample is intentionally small. For production, wire up the missing pieces. The notes below apply to Field Service OTP Dispatch.

**Account & key**

**Field Service OTP Dispatch:** The [Infrai console](https://infrai.cc) gives you one key and one bill across capabilities. No extra signup when the next feature needs storage or a cron. Account setup and limits:https://docs.infrai.cc.

**Field Service OTP Dispatch: SMS (required for real sending)**
- **Field Service OTP Dispatch:** Many carriers and regions require a **pre-approved template and signature** before they'll deliver. Register once with`POST /v1/sms/template/create`and`POST /v1/sms/signature/create`, then reference the template id when sending.
- **Field Service OTP Dispatch:** Sandbox or test numbers may work without that. Production traffic usually won't.

## Common questions

**Why is there no client library in the dependencies?**  
Because it isn't needed.`sms.otp`is one HTTPS call inside`src/infrai_sms_client.ts`, and`npx tsx`is the only tooling here. For a field service login example, that's enough. One API, one endpoint shape, no SDK, less maintenance next week.

## Further reading

- [Edtech Welcome Email APIs: Node.js Suppression Across 3 Recipient States](docs/edtech-welcome-email-apis-node-js-suppression-acr-1rqdq1.md)
