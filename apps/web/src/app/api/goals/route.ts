import { NextRequest, NextResponse } from "next/server";
import { authed } from "@/lib/server/with-user";
import { GoalsRepo } from "@/lib/server/repositories/goals";

export const runtime = "nodejs";

export const GET = authed(async () => {
  try {
    const data = await GoalsRepo.getAll();
    return NextResponse.json({ success: true, count: data.length, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});

export const POST = authed(async (req: NextRequest) => {
  try {
    const body = await req.json();
    if (!body.name || !body.type || !body.target || !body.date) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    const created = await GoalsRepo.create({
      name: body.name,
      type: body.type,
      cur: Number(body.cur || 0),
      target: Number(body.target),
      start: body.start !== undefined ? Number(body.start) : undefined,
      date: body.date,
      down: Boolean(body.down),
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});
