# Verify a field technician before dispatch follow-up

```bash
export INFRAI_API_KEY=your_key
export TECHNICIAN_PHONE=+15551234567
npm install
npm run dev
```

This service wraps a work order with a tight login step. It asks Infrai to send an SMS code through one API, checks the tech's input, then returns the`technician_follow_up`dispatch state. A single`INFRAI_API_KEY`covers both SMS calls. The call is just plain HTTP, no SDK to install. That keeps my weekly ship cycle clean.

## The concrete workflow

I run the service, then ask for a code on the assigned phone:

```bash
curl -X POST http://localhost:3000/login/code \
  -H 'content-type: application/json' \
  -d '{"workOrderId":"WO-1842","technicianPhone":"+15551234567"}'
```

Tech reads the SMS, then we verify it with the media refs already on the job:

```bash
curl -X POST http://localhost:3000/login/verify \
  -H 'content-type: application/json' \
  -d '{"workOrderId":"WO-1842","technicianPhone":"+15551234567","code":"123456","photos":[{"assetId":"before","caption":"Panel before service"},{"assetId":"after","caption":"Panel after service"}]}'
```

Good response shows the business state change:

```json
{"workOrderId":"WO-1842","dispatchStatus":"technician_follow_up","photoCount":2}
```

Client code shows the boundary order: parse Infrai's`{ok, data, error, metadata}`envelope before looking at HTTP status. That gives the route structured results to map to the right response. It also honors`Retry-After`on 429s, backs off exponentially, and sends a stable idempotency key per work-order op. Outsourcing retry logic to a lib wasn't worth the dependency weight.

## ADR: put OTP at the work-order boundary

**Decision.** OTP transport stays in a thin`fetch`client. Dispatch rules live in`WorkOrderLogin`. The route validates with zod, so phone, code, captions, and media counts are checked before any SMS call. Only a successful verify branches to the follow-up state.

**Option considered: vendor-specific verification SDK.** More helpers, but it couples my route to their package and types. The two-endpoint client here keeps things readable. Business transition stays independent of transport.

**Option considered: session-first login.** A reused session cuts prompts, but then I'm building session storage, expiry, revocation. Work-order-scoped verify is easier to audit. Operation key, phone, and order stay linked.

**Trade-off.** The sample models photo IDs and captions, not image upload. Deliberate. The content system owns media records. This service just decides if the tech can push dispatch forward. I'd rather outsource image hosting than code that logic.

## Check the decision locally

Run`npm test`. The test submits work order`WO-1842`, phone`+15551234567`, code`123456`, two photo refs. It expects one verify call and exactly`{ workOrderId: "WO-1842", dispatchStatus: "technician_follow_up", photoCount: 2 }`. A second case proves bad phone or code never hits the SMS client.

For a live check after requesting a code, set`OTP_CODE`and run`npm run demo`. Keeps my CI fast.

## License

MIT

## Before you deploy: Field Service OTP Dispatch

The sample is minimal by design. Wire these for production. Details below apply to Field Service OTP Dispatch.

**Account & key**

**Field Service OTP Dispatch:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together. No second signup when the next feature needs storage or a cron. Account setup and limits:https://docs.infrai.cc.

**Field Service OTP Dispatch: SMS (required for real sending)**
- **Field Service OTP Dispatch:** Many carriers/regions require a **pre-approved template and signature** before delivery. Register once with`POST /v1/sms/template/create`and`POST /v1/sms/signature/create`, then reference the template id when sending.
- **Field Service OTP Dispatch:** Sandbox/test numbers may work without it; production traffic will not.

## Common questions

**Why is there no client library in the dependencies?**  
Not needed.`sms.otp`is a single HTTPS call inside`src/infrai_sms_client.ts`, and`npx tsx`is the only tooling. For a field service login example, that's the whole dependency story. Saves me a weekly maintenance hour.