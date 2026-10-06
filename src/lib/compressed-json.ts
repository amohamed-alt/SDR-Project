import { gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);

export async function compressedJsonResponse(
  request: Request,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  const started = performance.now();
  const json = JSON.stringify(payload);
  const serializationMs = performance.now() - started;
  const acceptsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(request.headers.get("accept-encoding") || "");
  const baseHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Accept-Encoding",
    ...headers,
    "Server-Timing": [headers["Server-Timing"], `serialize;dur=${serializationMs.toFixed(1)}`].filter(Boolean).join(", "),
  };

  if (!acceptsGzip || json.length < 1_024) {
    return new Response(json, { headers: baseHeaders });
  }

  const compressed = await gzipAsync(Buffer.from(json), { level: 6 });
  return new Response(new Uint8Array(compressed), {
    headers: {
      ...baseHeaders,
      "Server-Timing": `${baseHeaders["Server-Timing"]}, compress;dur=${(performance.now() - started - serializationMs).toFixed(1)}`,
      "Content-Encoding": "gzip",
      "Content-Length": String(compressed.byteLength),
    },
  });
}
