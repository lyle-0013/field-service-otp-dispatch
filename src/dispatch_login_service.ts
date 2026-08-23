import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { createSmsClient, InfraiRequestError } from "./infrai_sms_client.js";
import { WorkOrderLogin } from "./work_order_login.js";

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export function createDispatchServer(login: WorkOrderLogin) {
  return createServer(async (request, response) => {
    try {
      if (request.method !== "POST") return send(response, 405, { error: "method_not_allowed" });
      const body = await readJson(request);
      if (request.url === "/login/code") return send(response, 202, await login.requestCode(body));
      if (request.url === "/login/verify") return send(response, 200, await login.verifyAndDispatch(body));
      return send(response, 404, { error: "route_not_found" });
    } catch (error) {
      if (error instanceof ZodError) return send(response, 400, { error: "invalid_request", issues: error.issues });
      if (error instanceof InfraiRequestError) {
        const status = error.status >= 400 && error.status < 500 ? error.status : 502;
        return send(response, status, { error: error.detail.code ?? "sms_rejected", message: error.message });
      }
      return send(response, 500, { error: "request_failed" });
    }
  });
}

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3000);
  createDispatchServer(new WorkOrderLogin(createSmsClient())).listen(port, () => {
    console.log(`field-service login listening on http://localhost:${port}`);
  });
}
