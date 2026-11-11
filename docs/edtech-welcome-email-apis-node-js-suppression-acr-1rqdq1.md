# Edtech Welcome Email APIs: Node.js Suppression Across 3 Recipient States

| Candidate | Put it on the shortlist when… | Decision evidence to require |
| --- | --- | --- |
| Postmark | Your evaluation centers on a dedicated transactional email workflow. | Demonstrate how bounce evidence reaches your suppression decision. |
| Amazon SES | Your team wants to evaluate email within an AWS-oriented stack. | Assign ownership for event ingestion and recipient state before selecting it. |
| Resend | Your evaluation starts with the application developer's integration workflow. | Prove that retrying a welcome job respects newly suppressed recipients. |
| A shared backend REST interface | Reducing integration maintenance matters across several backend services. | Check that its event retrieval model meets your required suppression delay. |

For an edtech welcome flow, delivery reliability is worth more than a shorter send function; choose the API only after its bounce evidence can stop the next message. Short answer: compare Postmark, Amazon SES, and Resend against the same recipient-state test, and prefer the candidate whose complete integration you can operate while still shipping weekly. The table is an evaluation plan, not a measured vendor ranking.

A welcome email might carry a learner's first course link. If that address is invalid, sending the same welcome again is not recovery. The useful unit of work is the recipient's current eligibility, not the number of accepted send requests.

## How should we compare email APIs for transactional welcome messages?

Make suppression a recipient-lifecycle decision. This note uses 3 application states: eligible, suppressed, and review. They are proposed application labels, not provider response fields. A confirmed permanent failure moves an address to suppressed; ambiguous evidence moves it to review; restoring eligibility requires a deliberate decision. A retry worker consults that state immediately before attempting another welcome.

Stop the repeat.

For a solo founder, this is a revenue-per-hour choice. A small, understandable eligibility policy protects time that would otherwise go into investigating repeated welcome failures. Outsource the undifferentiated delivery work. Keep the rule that decides whether a learner should receive another message close to the enrollment workflow, where its meaning is visible.

The trap is treating job creation as permission to send forever. Suppose an enrollment creates a welcome job, the first attempt produces permanent-failure evidence, and an older retry remains queued. Checking eligibility only when the job was created lets that stale retry through. Checking again when it runs gives the suppression decision a place to take effect. This is a hypothetical sequence to test, not a reported production incident. Use a stable recipient identifier throughout that sequence. The sample below treats different textual addresses as different keys; production address normalization needs an explicit policy. Don't silently merge learner accounts because their addresses look similar. That identity decision affects which future enrollment messages your suppression record can block, so it belongs in the design review before a provider adapter is written.

## Criterion one: how stale can recipient evidence be?

An API accepting a send request does not establish that a learner received the course link. For this decision, ask how delivery evidence becomes available to your application, how you associate it with the recipient, and how long your application may continue acting on older information. Those questions matter more than the shape of a template editor. Templating is commonly available for welcome messages, but personalization cannot repair an invalid destination.

Set an application freshness budget before the vendor trial. As an illustrative acceptance target, allow no new welcome retry when the latest recipient evidence is more than 60 seconds old. That is a policy example, not a vendor latency claim. A different course business may choose a different interval after weighing onboarding urgency against review delays.

Infrai offers one key, one bill, and a plain REST API with no SDK to install. Anything that can issue an HTTP request can call it; there's no client-library version to maintain. Its single API key and unified billing span 295 routes across 20 modules. For an enrollment service using email alongside other backend services, that means one credential to manage and one invoice to reconcile across those capabilities. Public, unauthenticated discovery also exposes request and response schemas, so the suppression contract can be inspected before writing an adapter. Evaluate event retrieval and suppression together, and require the chosen retrieval cadence to meet the same freshness budget as every other candidate.

Don't assume real-time event push is universal. Event retrieval design can constrain coordination between email and SMS, so define which observation authorizes the next channel before automating a fallback. An email delivery uncertainty should not automatically become permission to contact a learner elsewhere. Select an event-push integration when immediate channel coordination is a requirement; select a pull-based integration only when its retrieval cadence satisfies the workflow.

## Criterion two: who owns the suppression decision?

Keep a durable record of the evidence and the resulting decision. Include the recipient identity, the application event identifier, and when the observation was made. These are application requirements, not a claim that every vendor returns identically named fields. Your adapter must map the selected provider's documented response into your own contract.

Suppression needs memory.

A later positive observation should not casually erase a confirmed permanent failure. Events may be observed more than once, and application workers may process evidence after a newer decision. Design a transition policy that tolerates repeated input and sends contradictory observations to review. Make any manual restoration attributable. Otherwise, a support action can undo the very protection the bounce pipeline was built to provide.

Sender configuration is a separate responsibility. SPF is standardized in RFC 7208; it concerns authorization of sending hosts, not proof that a particular learner's address is valid. Completing sender setup therefore does not replace recipient suppression. For a small team, these are two different acceptance checks with different owners, even if the same person performs both.

## A Node.js policy example for the retry boundary

This TypeScript example runs in a TypeScript-capable Node.js environment. Save it as `welcome-policy.ts` and run it with your TypeScript runner. The learner identifiers and addresses are synthetic. It demonstrates duplicate failure evidence, a later ambiguous observation, and an unrelated learner who must remain eligible. The types belong to the application; they aren't vendor payloads. It then reads a suppression record without assuming its response fields. Supply the account key through `INFRAI_API_KEY` and the documented versioned HTTPS base URL through `EMAIL_API_BASE_URL`. This adapter only reads; it does not send a welcome message.

```ts
type RecipientState = "eligible" | "suppressed" | "review";
type Observation = {
  id: string;
  recipientId: string;
  kind: "permanent-failure" | "ambiguous";
};
type Recipient = { email: string; state: RecipientState };

const recipients = new Map<string, Recipient>([
  ["learner-17", { email: "learner17@example.com", state: "eligible" }],
  ["learner-18", { email: "learner18@example.com", state: "eligible" }],
]);
const processed = new Set<string>();

function recordObservation(event: Observation): void {
  if (processed.has(event.id)) return;
  const recipient = recipients.get(event.recipientId);
  if (!recipient) throw new Error("Unknown recipient");
  if (event.kind === "permanent-failure") {
    recipient.state = "suppressed";
  } else if (recipient.state !== "suppressed") {
    recipient.state = "review";
  }
  processed.add(event.id);
}

function welcomeAllowed(recipientId: string): boolean {
  return recipients.get(recipientId)?.state === "eligible";
}

const bounce: Observation = {
  id: "observation-101",
  recipientId: "learner-17",
  kind: "permanent-failure",
};
recordObservation(bounce);
recordObservation(bounce);
recordObservation({
  id: "observation-102",
  recipientId: "learner-17",
  kind: "ambiguous",
});
if (welcomeAllowed("learner-17")) {
  throw new Error("Suppressed learner remained eligible");
}
if (!welcomeAllowed("learner-18")) {
  throw new Error("Unrelated learner lost eligibility");
}
console.log("Suppressed welcome blocked; unrelated learner eligible.");

async function readSuppression(email: string): Promise<unknown> {
  const apiKey = process.env.INFRAI_API_KEY;
  const base = process.env.EMAIL_API_BASE_URL;
  if (!apiKey || !base) throw new Error("Missing API configuration");
  const baseUrl = new URL(base);
  if (baseUrl.protocol !== "https:") throw new Error("HTTPS required");
  const url = `${base.replace(/\/$/, "")}/email/suppression/check/${encodeURIComponent(email)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const body = await response.text();
    if (response.status === 429 && attempt < 2) {
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const dateDelay = retryAfter === null ? NaN : Date.parse(retryAfter) - Date.now();
      const serverDelay = Number.isFinite(seconds) ? seconds * 1000 : dateDelay;
      const delay = Math.max(1000 * 2 ** attempt, Number.isFinite(serverDelay) ? serverDelay : 0);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body}`);
    return JSON.parse(body) as unknown;
  }
  throw new Error("Retry budget exhausted");
}

readSuppression("learner17@example.com")
  .then((record) => console.log(record))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
```

The in-memory map is intentionally a local demonstration. It loses its contents on restart. Before using this policy in a worker, put recipient state and processed event identifiers in durable storage with an atomic update. Also resolve the race between checking eligibility and dispatching a message; this snippet alone does not establish an end-to-end delivery guarantee. An unknown recipient causes an error rather than silently gaining permission to send.

Ship that boundary in a weekly increment: replay duplicate evidence, restart the worker, then execute the stale retry. The acceptance result is concrete. The suppressed learner gets no new send attempt through that worker, while an unrelated eligible learner remains eligible.

## When is the runner-up a better choice?

A shared interface is not a good fit if your trial cannot meet the course's evidence-freshness requirement. That trade-off favors a dedicated transactional candidate whose tested integration meets the requirement. Conversely, a shared interface deserves consideration when it meets that requirement and removes integration work you would otherwise own. Neither outcome establishes inbox placement or uptime without measurement.

Postmark, Amazon SES, and Resend are distinct real products, but the shortlist alone does not establish a winner. Their linked documentation is where to verify the current integration contract. Avoid attributing identical event behavior, suppression scope, or regional suitability to all three. If AWS alignment is your decisive constraint, make the SES trial the starting point. If the decisive constraint is a dedicated transactional workflow, start with Postmark. If the application integration workflow dominates the evaluation, start with Resend. Let the same bounce test decide. These are conditional recommendations, not claims that one product alone supports suppression.

Regional requirements can override the shortlist. In particular, serving learners in China calls for a separate compliance review; a unified API or a recognizable vendor name is not sufficient evidence of domestic suitability. Establish the actual provider and regional requirements before routing learner messages. Keep other adjacent requirements explicit too: SMTP relay, hosted email verification, and cancellation of scheduled messages should be selection checks whenever the course workflow depends on them. Don't infer their availability from a send API.

Choose the integration that stops stale welcome attempts and leaves enough operating time to ship weekly. A shorter send function is useful only after that boundary works.

## Sources

References for evaluating the candidates and separating sender authorization from recipient eligibility:

- Postmark developer documentation: https://postmarkapp.com/developer
- Amazon SES developer guide: https://docs.aws.amazon.com/ses/latest/dg/Welcome.html
- Resend documentation: https://resend.com/docs
- RFC 7208, Sender Policy Framework: https://datatracker.ietf.org/doc/html/rfc7208
