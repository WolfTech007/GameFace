import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ARCHIVED = {
  error: "Face Hockey has been archived.",
  archived: true,
} as const;

export async function POST() {
  return NextResponse.json(ARCHIVED, { status: 410 });
}

export async function GET() {
  return NextResponse.json(ARCHIVED, { status: 410 });
}
