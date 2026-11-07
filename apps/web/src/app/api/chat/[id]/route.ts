import { NextRequest, NextResponse } from "next/server";
import { authed } from "@/lib/server/with-user";
import { ChatRepo } from "@/lib/server/repositories/chat";

export const runtime = "nodejs";

export const GET = authed(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const convo = await ChatRepo.getConversation(id);
    if (!convo) return NextResponse.json({ success: false, error: "Conversation not found" }, { status: 404 });
    return NextResponse.json({ success: true, data: convo });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});

export const PUT = authed(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const body = await req.json();
    if (body.title) {
      await ChatRepo.renameConversation(id, body.title);
    }
    const updated = await ChatRepo.getConversation(id);
    return NextResponse.json({ success: true, data: updated });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});

export const DELETE = authed(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const ok = await ChatRepo.deleteConversation(id);
    if (!ok) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true, message: "Conversation deleted" });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});
