// Staff activity ping. The proxy records the time of this request (§11.2 idle rule).
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
