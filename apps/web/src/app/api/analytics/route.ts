import { NextResponse } from "next/server";
import { authed } from "@/lib/server/with-user";
import { FinancialService } from "@/lib/server/services/analytics";

export const runtime = "nodejs";

export const GET = authed(async () => {
  try {
    const metrics = await FinancialService.getMetrics();
    return NextResponse.json({ success: true, data: metrics });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});
