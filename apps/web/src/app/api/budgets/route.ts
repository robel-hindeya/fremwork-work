import { NextRequest, NextResponse } from "next/server";
import { authed } from "@/lib/server/with-user";
import { BudgetsRepo } from "@/lib/server/repositories/budgets";

export const runtime = "nodejs";

export const GET = authed(async () => {
  try {
    const data = await BudgetsRepo.getAll();
    return NextResponse.json({ success: true, count: data.length, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});

export const POST = authed(async (req: NextRequest) => {
  try {
    const body = await req.json();
    if (!body.k || !body.budget) {
      return NextResponse.json({ success: false, error: "Missing required fields (k, budget)" }, { status: 400 });
    }

    const created = await BudgetsRepo.create({
      k: body.k,
      budget: Number(body.budget),
      owner: body.owner || "Unassigned",
      alert: body.alert || "90% of budget",
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});
