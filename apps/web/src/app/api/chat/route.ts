import { NextRequest, NextResponse } from "next/server";
import { authed } from "@/lib/server/with-user";
import { ChatRepo } from "@/lib/server/repositories/chat";
import { AgentError, runFinancialAgent } from "@/lib/server/agent/engine";

export const runtime = "nodejs";

export const GET = authed(async () => {
  try {
    const list = await ChatRepo.getAllConversations();
    return NextResponse.json({ success: true, count: list.length, data: list });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
});

export const POST = authed(async (req: NextRequest) => {
  try {
    const { conversationId, text, files, mode = "Balanced", retry = false } = await req.json();

    const q = (text || "").trim() || (files?.length ? "Analyze the attached file." : "");
    if (!q) {
      return NextResponse.json({ success: false, error: "Empty message" }, { status: 400 });
    }

    const cid = conversationId || `c-${Date.now().toString(36)}`;

    if (retry) await ChatRepo.dropTrailingAiMessages(cid);
    else await ChatRepo.addMessage(cid, { role: "user", text: q, files: files || [], status: "done" });

    const stored = (await ChatRepo.getConversation(cid))?.messages ?? [];
    const history = stored.filter((m) => m.text).map((m) => ({ role: m.role, text: m.text! }));

    const attached = stored.at(-1)?.files ?? [];
    if (attached.length) {
      const names = attached.map((f) => f.name).join(", ");
      history[history.length - 1].text += `\n\n[The user attached: ${names}. You can only see the file names, not the contents. Tell them that, and suggest they paste the figures into the chat or add them as transactions.]`;
    }

    const agentRes = await runFinancialAgent(history, mode);

    const aiMessage = await ChatRepo.addMessage(cid, { role: "ai", mode, status: "done", text: agentRes.text, files: [] });

    return NextResponse.json({
      success: true,
      data: {
        conversationId: cid,
        aiMessage: { ...aiMessage, thought: agentRes.thought, toolCalls: agentRes.toolCalls, actionsTaken: agentRes.actionsTaken },
      },
    });
  } catch (err: any) {
    const status = err instanceof AgentError ? err.status : 500;
    return NextResponse.json({ success: false, error: err.message }, { status });
  }
});
