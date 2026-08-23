import { gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);

export async function compressedJsonResponse(
  request: Request,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  const json = JSON.stringify(payload);
  const acceptsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(request.headers.get("accept-encoding") || "");
  const baseHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Accept-Encoding",
    ...headers,
  };

  if (!acceptsGzip || json.length < 1_024) {
    return new Response(json, { headers: baseHeaders });
  }

  const compressed = await gzipAsync(Buffer.from(json), { level: 6 });
  return new Response(new Uint8Array(compressed), {
    headers: {
      ...baseHeaders,
      "Content-Encoding": "gzip",
      "Content-Length": String(compressed.byteLength),
    },
  });
}
