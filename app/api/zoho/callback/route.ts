export function GET(request: Request) {
  const callbackUrl = new URL(request.url);

  // ponytail: parse expected params without exposing the code; token exchange comes later.
  callbackUrl.searchParams.get("code");
  callbackUrl.searchParams.get("location");

  return Response.json(
    { message: "Zoho callback reached" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
