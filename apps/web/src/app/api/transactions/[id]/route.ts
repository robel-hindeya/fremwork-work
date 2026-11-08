import { NextRequest, NextResponse } from "next/server";
import { transactionError } from "@/lib/server/validation";
import { authed } from "@/lib/server/with-user";
import { TransactionsRepo } from "@/lib/server/repositories/transactions";

export const runtime = "nodejs";

export const GET = authed(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const tx = await TransactionsRepo.getById(id);
    if (!tx) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true, data: tx });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});

export const PUT = authed(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const body = await req.json();
    const invalid = transactionError(body, true);
    if (invalid) return NextResponse.json({ success: false, error: invalid }, { status: 400 });
    const updated = await TransactionsRepo.update(id, body);
    if (!updated) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true, data: updated });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});

export const DELETE = authed(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const ok = await TransactionsRepo.delete(id);
    if (!ok) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true, message: "Transaction deleted" });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});
