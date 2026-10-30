export const dynamic = "force-dynamic";

const upstream = `${process.env.API_URL || "http://127.0.0.1:8000"}/api/chat/stream`;

export async function POST(request: Request) {
  const cookie = request.headers.get("cookie");
  const response = await fetch(upstream, {
    method: "POST",
    headers: {
      "Content-Type": request.headers.get("content-type") || "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: await request.arrayBuffer(),
    cache: "no-store",
    signal: request.signal,
  });
  const headers = new Headers({
    "Content-Type": response.headers.get("content-type") || "text/event-stream",
    // no-transform makes Next's compression middleware skip the SSE body, which
    // would otherwise be gzipped into one buffered block.
    "Cache-Control": `${response.headers.get("cache-control") || "no-cache"}, no-transform`,
    "X-Accel-Buffering": "no",
  });
  const session = response.headers.get("x-session-id");
  if (session) headers.set("X-Session-ID", session);
  return new Response(response.body, { status: response.status, headers });
}
