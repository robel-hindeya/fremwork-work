import { NextRequest, NextResponse } from "next/server";
import { authed } from "@/lib/server/with-user";
import { TasksRepo } from "@/lib/server/repositories/tasks";

export const runtime = "nodejs";

export const GET = authed(async () => {
  try {
    const data = await TasksRepo.getAll();
    return NextResponse.json({ success: true, count: data.length, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});

export const POST = authed(async (req: NextRequest) => {
  try {
    const body = await req.json();
    if (!body.name || !body.prompt || !body.freq) {
      return NextResponse.json({ success: false, error: "Missing required fields (name, prompt, freq)" }, { status: 400 });
    }

    const created = await TasksRepo.create({
      name: body.name,
      prompt: body.prompt,
      freq: body.freq,
      next: body.next,
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});
