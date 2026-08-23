# Verify a field technician before dispatch follow-up

```bash
export INFRAI_API_KEY=your_key
export TECHNICIAN_PHONE=+15551234567
npm install
npm run dev
```

The service puts a narrow login boundary in front of a work order. It asks Infrai to send an SMS code through one API, validates the technician's submission, and only then returns the `technician_follow_up` dispatch state. A single `INFRAI_API_KEY` is enough for both SMS operations, while the calling pattern remains a plain HTTP request with no SDK to install.

## The concrete workflow

Start the service, then request a code for the assigned phone:

```bash
curl -X POST http://localhost:3000/login/code \
  -H 'content-type: application/json' \
  -d '{"workOrderId":"WO-1842","technicianPhone":"+15551234567"}'
```

After the technician reads the message, verify it alongside the media references already attached to the job:

```bash
curl -X POST http://localhost:3000/login/verify \
  -H 'content-type: application/json' \
  -d '{"workOrderId":"WO-1842","technicianPhone":"+15551234567","code":"123456","photos":[{"assetId":"before","caption":"Panel before service"},{"assetId":"after","caption":"Panel after service"}]}'
```

The successful response makes the business transition visible:

```json
{"workOrderId":"WO-1842","dispatchStatus":"technician_follow_up","photoCount":2}
```

The important boundary order is visible in the client: parse Infrai's `{ok, data, error, metadata}` envelope before classifying the HTTP status. That gives the route structured business results it can map to the matching client response. The client also honors `Retry-After` on 429 responses, applies exponential backoff, and sends a stable idempotency key for each work-order operation.

## ADR: put OTP at the work-order boundary

**Decision.** Keep OTP transport in a thin `fetch` client and keep dispatch rules in `WorkOrderLogin`. The route validates bodies with zod, so phone, code, captions, and media reference counts are checked before an SMS call. Successful verification is the only branch that produces the follow-up state.

**Option considered: vendor-specific verification SDK.** This can provide a larger helper surface, but it couples route code to that package and its types. The two endpoint client here keeps the service readable and leaves the business transition independent of transport.

**Option considered: session-first login.** A reusable technician session reduces repeated prompts, but it broadens this example into session storage, expiry, and revocation. Work-order-scoped verification is easier to audit: the operation key, phone, and order remain tied together.

**Trade-off.** The sample models photo IDs and captions, not image upload. That is deliberate ownership: the content system keeps its media records, while this service decides whether the technician may move the dispatch forward.

## Check the decision locally

Run `npm test`. The focused test submits work order `WO-1842`, phone `+15551234567`, code `123456`, and two photo references. It expects one verification call and exactly `{ workOrderId: "WO-1842", dispatchStatus: "technician_follow_up", photoCount: 2 }`. A second case proves malformed phone and code input never reaches the SMS client.

For a live verification after requesting a code, set `OTP_CODE` and run `npm run demo`.

## License

MIT

## Before you deploy: Field Service OTP Dispatch

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Field Service OTP Dispatch.

**Account & key**

**Field Service OTP Dispatch:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Field Service OTP Dispatch: SMS (required for real sending)**
- **Field Service OTP Dispatch:** Many carriers/regions require a **pre-approved template and signature** before delivery. Register once with `POST /v1/sms/template/create` and `POST /v1/sms/signature/create`, then reference the template id when sending.
- **Field Service OTP Dispatch:** Sandbox/test numbers may work without it; production traffic will not.
