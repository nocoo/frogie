import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export async function daemonModelServer() {
  const requests: { model: string; messages: unknown }[] = [];
  const waiting: ServerResponse[] = [];
  let bothEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    bothEntered = resolve;
  });
  const modelId = "daemon-barrier-model";

  function respond(response: ServerResponse) {
    if (response.destroyed) return;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = {
      id: "chatcmpl-daemon-fixture",
      object: "chat.completion.chunk",
      created: 1,
      model: modelId,
    };
    response.write(
      `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: "Barrier released answer" }, finish_reason: null }] })}\n\n`,
    );
    response.end(
      `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 } })}\n\ndata: [DONE]\n\n`,
    );
  }

  let released = false;
  const server = createServer((request, response) => {
    void (async () => {
      if (request.url !== "/v1/chat/completions" || request.method !== "POST") {
        response.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push(
        JSON.parse(Buffer.concat(chunks).toString()) as {
          model: string;
          messages: unknown;
        },
      );
      if (released) respond(response);
      else waiting.push(response);
      if (requests.length === 2) bothEntered();
    })().catch(() => response.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const model = {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    apiKey: "daemon-fixture-key",
    modelId,
    contextWindow: 32_000,
    maxTokens: 1024,
    thinkingLevel: "off" as const,
  };
  return {
    model,
    requests,
    entered,
    release() {
      released = true;
      for (const response of waiting.splice(0)) respond(response);
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
