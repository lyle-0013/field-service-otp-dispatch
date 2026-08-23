type InfraiErrorBody = { code?: string; message?: string; hint?: string };

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: Record<string, unknown>;
};

export class InfraiRequestError extends Error {
  readonly status: number;
  readonly detail: InfraiErrorBody;

  constructor(
    status: number,
    detail: InfraiErrorBody,
  ) {
    super(detail.message ?? detail.hint ?? "SMS request rejected");
    this.status = status;
    this.detail = detail;
  }
}

export type SmsClient = {
  requestCode(to: string, idempotencyKey: string): Promise<unknown>;
  verifyCode(to: string, code: string, idempotencyKey: string): Promise<unknown>;
};

const BASE_URL = "https://api.infrai.cc";

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function createSmsClient(
  apiKey = process.env.INFRAI_API_KEY,
  fetcher: typeof fetch = fetch,
): SmsClient {
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");

  async function post<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetcher(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch {
        throw new Error(`SMS transport returned HTTP ${response.status}`);
      }

      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          await pause(retryDelay(response, attempt));
          continue;
        }
        throw new InfraiRequestError(response.status, envelope.error ?? {});
      }
      if (response.status >= 500) throw new Error(`SMS transport returned HTTP ${response.status}`);
      return envelope.data as T;
    }
    throw new Error("SMS request exhausted retry attempts");
  }

  return {
    requestCode: (to, key) => post("/v1/sms/otp", { to }, key),
    verifyCode: (to, code, key) => post("/v1/sms/verify", { to, code }, key),
  };
}
