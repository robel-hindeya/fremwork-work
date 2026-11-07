import { NextRequest, NextResponse } from "next/server";
import { authed } from "@/lib/server/with-user";
import { ProjectsRepo } from "@/lib/server/repositories/projects";

export const runtime = "nodejs";

export const GET = authed(async () => {
  try {
    const data = await ProjectsRepo.getAll();
    return NextResponse.json({ success: true, count: data.length, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});

export const POST = authed(async (req: NextRequest) => {
  try {
    const body = await req.json();
    if (!body.name || !body.desc) {
      return NextResponse.json({ success: false, error: "Missing required fields (name, desc)" }, { status: 400 });
    }

    const created = await ProjectsRepo.create({
      name: body.name,
      desc: body.desc,
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});
