# Template Ownership in Node.js: Receipts, Verify Links, and Magic-Link Email

A game backend sends two messages that look trivial and carry real risk: the order receipt that goes out after a payment settles, and the verify-email link that turns a passwordless signup into a usable account. Use the mail provider for delivery only. Keep the template, the token, and the copy inside your own Node.js service, under the same review and rollback rules as the code that charged the card.

That split is boring on purpose. Delivery is undifferentiated work — IP reputation, connection retries, bounce handling, complaint feeds — and renting it is a good trade for a one-person shop. Rendering is product work. A receipt is a financial record and a verify link is an authentication step, so both have to be reproducible from a commit hash a year later.

One repo, one diff, one rollback.

## Should your Node.js app own the verify email link and its template?

Split it by what has to be reproducible. The provider decides how a message reaches an inbox. Your service decides what the message says and what the link inside it proves.

The token half isn't negotiable. Your backend issues a short-lived, purpose-bound value — sign a payload with an HMAC, give it a random identifier, set a 15-minute expiry — and your backend stays the only thing that can consume it. A magic link for returning players and a verify link for new ones are the same primitive with different landing pages. OWASP's forgot-password guidance lists the properties worth copying: an unpredictable value, a short lifetime, single use, and a response that never reveals whether an address is already registered.

The template half is where ownership quietly slips away. Hosted template editors — Postmark and SendGrid both ship one — keep the markup and its version history on the provider side, and the send call carries variables instead of rendered HTML. For a receipt after a settled payment that's the wrong direction, because the item list, the tax line, and the refund window are product data with a legal shelf life. For a passwordless welcome mail it's worse. The link is the entire message, and a variable that renders empty produces a polite email with a dead button and one support ticket per recipient.

## Failure modes in a passwordless welcome flow

Corporate mail security scanners fetch the URLs in an incoming message before a human ever sees it. If your verify endpoint consumes the token on GET, the scanner burns it, and the player clicks a link that reports itself as already used. The fix is structural: make the GET render a confirmation page and consume the token on the POST that follows, and treat a second POST with the same identifier as a no-op rather than an error.

Referrer leakage is the second one. A verify page that loads a third-party analytics script can hand the full URL — token and all — to someone else's server, so send a strict `Referrer-Policy` on that route and strip the token from the URL as soon as it is exchanged for a signed cookie.

Then there's the boring stuff that generates most of the tickets. Typo'd addresses leave an account stranded with no way back, so store the unverified address, allow one edit, and expose a rate-limited "send it again" action rather than a button that fires a new message on every click. Give verification mail its own subdomain and its own stream, separate from patch notes and promo blasts, because a campaign that draws complaints will drag account activation down with it. Yahoo's sender requirements and the equivalent rules at other large mailbox providers assume authenticated mail with SPF, DKIM, and a DMARC record that aligns — a passwordless product with unauthenticated mail has no login story at all.

Expiry is a product decision, not a security ritual. Fifteen minutes is fine for a magic link a player requested a second ago; a welcome verify link that arrives while someone is at work deserves a longer window and a friendly re-issue page when it lapses.

## A minimal implementation of the send path

Two functions, one adapter. The template module renders both messages, the crypto module owns the token, and the transport is a thin HTTP call I can point at a different vendor in an afternoon.

```ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type Purpose = "verify-email" | "sign-in";

const secret = process.env.MAIL_LINK_SECRET ?? "";
if (Buffer.byteLength(secret) < 32) throw new Error("MAIL_LINK_SECRET must be at least 32 bytes");

const b64 = (v: string) => Buffer.from(v).toString("base64url");
const sign = (payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function issueLink(userId: string, purpose: Purpose, ttlSeconds: number) {
  const jti = randomBytes(16).toString("hex");
  const payload = b64(JSON.stringify({ sub: userId, purpose, jti, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return { jti, url: `https://play.example.com/auth/${purpose}?t=${payload}.${sign(payload)}` };
}

export function readLink(token: string) {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) throw new Error("malformed token");
  const got = Buffer.from(mac, "base64url");
  const want = Buffer.from(sign(payload), "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new Error("bad signature");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("expired");
  return claims as { sub: string; purpose: Purpose; jti: string; exp: number };
}

// Templates are ordinary modules: reviewed, diffed, snapshot-tested, deployed with the app.
export function welcomeVerify(player: { handle: string }, url: string) {
  return {
    subject: `${player.handle}, confirm your email to finish setup`,
    text: `Welcome, ${player.handle}.\n\nConfirm this address: ${url}\n\nThe link works for 30 minutes.`,
    html: `<p>Welcome, ${player.handle}.</p><p><a href="${url}">Confirm this address</a></p><p>The link works for 30 minutes.</p>`,
  };
}

export async function deliver(to: string, msg: { subject: string; text: string; html: string }, idempotencyKey: string) {
  const res = await fetch("https://mail.example.net/api/messages", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.MAIL_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ from: "play@mail.example.com", to, ...msg }),
  });
  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after") ?? 5);
    throw Object.assign(new Error("rate limited"), { retryAfterMs: wait * 1000 });
  }
  if (!res.ok) throw new Error(`send rejected: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string };
}
```

The idempotency key matters more than it looks. Derive it from the token identifier for a verify mail and from the payment identifier for a receipt, and a retry after a network wobble stops turning into two messages in the player's inbox. The same call shape carries the receipt: swap the template function, keep the transport.

## How I test and ship a template change

Render the templates in unit tests and snapshot the output, including the plain-text alternative. Broken HTML rarely fails a deploy; it fails silently in an inbox two hours later, and a snapshot diff in a pull request is the cheapest early warning I know of. Point a staging build at a capture-only address so every branch produces real messages nobody receives, and keep one manual check before a template change ships: open the rendered mail on a narrow phone screen and click the actual link, because a call to action that wraps or renders as bare text is invisible to a player even though every assertion passed.

Log both identifiers — the provider's message id and your own attempt id — on the same line as the recipient hash and the template version. Without that pairing, "did the receipt go out?" turns into a manual search across two systems while a customer waits. Track bounce and complaint rates as a rolling ratio and alert on the derivative, not the total, since a bad template usually shows up as a sudden slope change rather than a threshold breach.

Budget for the event path too. If your provider exposes delivery events by polling rather than by push, that worker is real code with real failure modes: cursor storage, backoff, and a dead-letter path. It is often simpler to treat the send as fire-and-verify — record the accepted id, reconcile later — than to build a webhook receiver you will maintain forever for two message types.

## When a hosted template editor is the better trade

The catch with owning templates in the repo is that every copy change needs an engineer and a deploy. If a support lead wants to soften the wording of a welcome email on a Tuesday, my pull-request-shaped process is a tax, not a control.

| Signal | Own it in the repo | Hosted template editor |
| --- | --- | --- |
| Who edits the copy | engineers, through review | support or marketing, without a deploy |
| What proves what shipped | git history plus a snapshot test | the provider's version history |
| Best-suited message | receipts, verify and magic links | lifecycle nudges, patch notes, campaigns |

So the rule I hold to is narrow: anything carrying money or authentication stays in the repo, and everything else can live wherever the person who writes it is comfortable. Stick with the hosted editor when non-engineers own the words and the message has no legal or security payload. If you need per-locale copy managed by translators, a hosted editor with translation workflow support will beat a homegrown one, and I would not spend a week rebuilding that.

I'm not sure the boundary holds at a larger company, where a mail team and a design system change the economics of both sides. For a solo operator shipping weekly, the split has one property that keeps earning its keep: when a player asks why their receipt says what it says, the answer is a commit, not a screenshot.

## Further reading

- OWASP, "Forgot Password Cheat Sheet": https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- Yahoo, "Sender Best Practices and Requirements": https://senders.yahooinc.com/best-practices/
- RFC 6376, "DomainKeys Identified Mail (DKIM) Signatures": https://www.rfc-editor.org/rfc/rfc6376
- RFC 7489, "Domain-based Message Authentication, Reporting, and Conformance (DMARC)": https://www.rfc-editor.org/rfc/rfc7489
- Google, "Email sender guidelines": https://support.google.com/a/answer/81126
- MDN, "Referrer-Policy": https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy
- Node.js, "crypto.timingSafeEqual": https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b
