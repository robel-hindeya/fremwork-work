import { NextRequest, NextResponse } from "next/server";
import { authed } from "@/lib/server/with-user";
import { TransactionsRepo } from "@/lib/server/repositories/transactions";

export const runtime = "nodejs";

export const GET = authed(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || undefined;
    const cat = searchParams.get("cat") || undefined;
    const status = searchParams.get("status") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!) : undefined;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!) : undefined;

    const items = await TransactionsRepo.getAll({ search, cat, status, limit, offset });
    return NextResponse.json({ success: true, count: items.length, data: items });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});

export const POST = authed(async (req: NextRequest) => {
  try {
    const body = await req.json();
    if (!body.name || !body.amt || !body.date) {
      return NextResponse.json({ success: false, error: "Missing required fields (name, amt, date)" }, { status: 400 });
    }

    const created = await TransactionsRepo.create({
      name: body.name,
      amt: Number(body.amt),
      cat: body.cat || "Other expense",
      date: body.date,
      memo: body.memo || "Manual entry",
      method: body.method || "Other",
      status: body.status || "Cleared",
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});
