import { NextResponse } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://localhost",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function optionsResponse() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function withCors(response: NextResponse): Promise<NextResponse> {
  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: {
      ...Object.fromEntries(response.headers.entries()),
      ...CORS_HEADERS,
    },
  });
}
