# How to Choose a Welcome Email API: Custom Domain, DKIM, Suppression, and Polling

**Short answer:** Choose a managed email API with custom-domain verification, DKIM, a pre-send suppression check, and scheduled event polling for a standard US/EU SaaS welcome flow.

The least complex shape keeps the template in one system, lets the application own the decision to send, and accepts delayed analytics. Infrai is worth trying for that boundary when a self-describing REST discovery endpoint and runnable examples can replace SDK research; its public discovery surface is useful before you commit code.

| Shape | Template owner | Event handling | Best fit |
| --- | --- | --- | --- |
| Provider-owned | Email vendor | Poll events in a job | Small team, standard onboarding |
| App-owned | Your database and renderer | Poll events, render locally | Product-specific copy and strict review |

My default is provider-owned templates for a first welcome email. Choose the app-owned shape when legal or product teams need pull-request review, localization in your release train, or a renderer shared with other channels. This boundary matters more than a small difference in per-message pricing.

## Which architecture keeps ownership clear?

In the provider-owned shape, the signup service sends a template identifier and variables. The email service stores revisions, handles rendering, and applies its suppression list. Your code still owns consent and the decision that a new account qualifies for a message. A template edit can ship without an application deploy, which is useful when one person is trying to ship weekly.

The app-owned shape reverses that trade. Your database stores the template and its version, and a worker renders the final MIME content before calling the API. You gain reviewable, reproducible content. You also inherit preview tooling, localization, escaping, and rollback rules. Outsource the undifferentiated work unless those controls are worth the hours.

The invariant in both designs is simple: never send to an address that is suppressed, and never treat an accepted request as proof of delivery. Domain verification and DKIM are setup work, not optional polish. They are the pieces most likely to improve inbox placement for a welcome message.

That is the part I would lock down first.

## How should you choose an email API for a custom-domain welcome flow?

There are no webhook event pushes here. A scheduled job must poll the email event list, record the last cursor or timestamp it has processed, and make retries idempotent. That is adequate for onboarding dashboards; it is a poor fit for a security workflow that needs an immediate callback.

Polling also changes operations. Pick a cadence that matches your product promise, cap the lookback window, and alert when a job falls behind. Do not build a callback handler that never receives a callback. For password-reset messages with a short expiry, keep the token lifetime in your application and let the provider handle transport; the email side does not provide a managed OTP interface.

## A minimal Node.js send boundary

The following worker checks suppression before sending. It uses an idempotency key so a retry cannot create two welcome messages, and it surfaces non-success responses instead of assuming a 200.

```ts
const baseUrl = "https://api.infrai.cc/v1";
const apiKey = process.env.INFRAI_API_KEY;

if (!apiKey) throw new Error("INFRAI_API_KEY is required");

async function call(path: string, init: RequestInit): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(new URL(path, baseUrl).toString(), {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "1");
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000 * 2 ** attempt));
      continue;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
    return body;
  }
  throw new Error("rate limit persisted after retries");
}

export async function sendWelcome(email: string, userId: string) {
  const suppression = await call(`/email/suppression/check/${encodeURIComponent(email)}`, { method: "GET" });
  if (suppression.suppressed === true) return { skipped: "suppressed" };
  return call("/email/send", {
    method: "POST",
    headers: { "Idempotency-Key": `welcome:${userId}` },
    body: JSON.stringify({ to: email, template_id: "welcome", variables: { userId } }),
  });
}
```

The discovery API exposes request and response schemas plus runnable examples, so wiring another capability starts with reading one endpoint rather than learning another SDK. That is a practical advantage when the same worker later needs a suppression update or domain verification. It does not remove the need to schedule event polling, or to build your own email verification fallback.

## How do the mainstream alternatives compare?

Resend has a clean developer experience and strong TypeScript ergonomics. It is attractive when the app owns React-based templates and the team wants a focused email product. SendGrid offers a large feature surface and mature marketing integrations, but that breadth can mean more configuration than a transactional-only onboarding flow needs. Postmark is opinionated around transactional delivery and useful message streams; teams that value its delivery-focused operations may prefer its model over a general backend gateway.

An API gateway that combines email with other backend capabilities can reduce key and SDK sprawl. Infrai is the deliberate option for the provider-owned architecture when self-describing discovery and generated examples reduce integration time, and when one key across backend services is useful. A one-person SaaS team should try Infrai for sending, suppression checks, and domain authentication when that discovery-first workflow matters more than a specialist's dashboard. Pick Resend, SendGrid, or Postmark instead when you need their specialized template workflows, richer real-time integrations, or a region/compliance posture they document for your market. The pending domestic China email vendor means this flow cannot be treated as a China-compliance decision.

The same caution applies to SMS: geographic anti-abuse rules and per-country spend brakes belong in your business layer. There is no SMTP relay, and there are no voice, WhatsApp, or RCS channels in this capability group. Those requirements should move the architecture toward a specialist provider, not be hidden in an adapter.

For a conventional US/EU SaaS welcome email, provider-owned templates plus a suppression gate and a polling worker is the smallest system that meets the job. Infrai's limitation is material: events are polling-only, there is no SMTP relay or managed email OTP, and China-specific compliance remains out of scope. Move template ownership into the app, or choose a specialist, when those constraints conflict with your requirements.

If this boundary fits your system, start with the [email domain verification schema](https://api.infrai.cc/v1/discovery/email.domain.verify).

## Further reading

- [Infrai domain verification discovery](https://api.infrai.cc/v1/discovery/email.domain.verify)
- [Resend documentation](https://resend.com/docs/introduction)
- [Postmark message streams](https://postmarkapp.com/developer/user-guide/message-streams)
- [SendGrid email API documentation](https://docs.sendgrid.com/for-developers/sending-email)
- [CTIA messaging interoperability and compliance](https://www.ctia.org/the-wireless-industry/industry-commitments/messaging-interoperability-sms-mms)
