import { db } from "../db";
import { calculate } from "./calculate";
import { FINANCIAL_AGENT_TOOLS } from "./tools";

export interface AgentResponse {
  thought: string;
  toolCalls: { tool: string; args: any; result: any }[];
  text: string;
  actionsTaken: string[];
}

export type ChatTurn = { role: "user" | "ai"; text: string };

/** A failure with a message that is safe and useful to show in the chat. */
export class AgentError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

const MAX_TURNS = 8;
const DEFAULT_DAILY_LIMIT = 50;
const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

const MODE_HINT: Record<string, string> = {
  Fast: "Answer as briefly as you can.",
  Balanced: "Be concise but show the key numbers.",
  "Deep Analysis": "Be thorough: work through the numbers step by step and consider scenarios and risks.",
};

const GEMINI_TOOLS = [
  {
    name: "calculate",
    description: "Perform exact arithmetic. Never do mental math.",
    parameters: {
      type: "OBJECT",
      properties: {
        expression: { type: "STRING", description: "Mathematical expression, e.g. '5395 / 1783'" },
        label: { type: "STRING", description: "What this calculation computes" },
      },
      required: ["expression"],
    },
  },
  {
    name: "get_financial_health",
    description: "Fetch cash on hand, runway, this month's revenue, expenses and net margin, and budget alerts.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "search_transactions",
    description: "Search or filter transactions in the ledger.",
    parameters: {
      type: "OBJECT",
      properties: {
        search: { type: "STRING", description: "Keyword for payee name or memo" },
        category: { type: "STRING", description: "Exact category name" },
        limit: { type: "NUMBER", description: "Max records to fetch (default 10)" },
      },
    },
  },

  {
    name: "get_budgets_status",
    description: "List all budgets with this month's spending and utilization.",
    parameters: { type: "OBJECT", properties: {} },
  },


  {
    name: "run_scenario_analysis",
    description: "Simulate the runway impact of a hire, a spending change or a revenue change.",
    parameters: {
      type: "OBJECT",
      properties: {
        monthlyCostChange: { type: "NUMBER", description: "Monthly change in expenses (+ for a new hire, - for savings)" },
        monthlyRevenueChange: { type: "NUMBER", description: "Monthly change in revenue (+ for growth, - for churn)" },
      },
    },
  },
];

const TOOL_IMPL: Record<string, string> = {
  get_financial_health: "getFinancialHealth",
  search_transactions: "searchTransactions",
  get_budgets_status: "getBudgetsStatus",
  run_scenario_analysis: "runScenarioAnalysis",
};

async function executeTool(name: string, args: any): Promise<any> {
  try {
    if (name === "calculate") {
      return { expression: args?.expression, result: calculate(String(args?.expression ?? "")), label: args?.label || "Calculation" };
    }
    const impl = FINANCIAL_AGENT_TOOLS[TOOL_IMPL[name]];
    if (!impl) return { error: `Unknown tool ${name}` };
    return await impl.execute(args || {});
  } catch (err: any) {
    return { error: err.message };
  }
}

async function failure(response: Response): Promise<AgentError> {
  // Provider payloads can contain account details. Only expose bounded, generic errors.
  if (response.status === 401 || response.status === 403) return new AgentError("The AI connection is unavailable. Please contact support.", 503);
  if (response.status === 429) return new AgentError("The AI service is busy. Please try again shortly.", 429);
  if (response.status === 404) return new AgentError("The configured AI model is unavailable. Please contact support.", 503);
  return new AgentError("The AI service could not complete this request. Please try again.");
}

/** Runs the tool-calling loop. `history` is the conversation so far and must end with the user's new message. */
export async function runFinancialAgent(history: ChatTurn[], mode: string = "Balanced"): Promise<AgentResponse> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey || /your[-_]|placeholder/i.test(apiKey)) {
    throw new AgentError("The AI is not connected yet. Please try again once your administrator has configured it.", 503);
  }
  const dailyLimit = Number(process.env.AI_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT;
  if ((await db.rpc<number>("bump_ai_usage")) > dailyLimit) {
    throw new AgentError(`You've reached today's limit of ${dailyLimit} AI requests. It resets at midnight UTC.`, 429);
  }

  const model = process.env.GEMINI_MODEL;
  if (!model || !/^[a-zA-Z0-9._-]+$/.test(model)) {
    throw new AgentError("The AI model is not configured. Please contact support.", 503);
  }

  const today = new Date().toISOString().split("T")[0];
  const systemInstruction = {
    parts: [
      {
        text: `You are Fremwork AI, a financial copilot for founders, CFOs and accountants. Today is ${today}.
Use your tools to read the user's real ledger. Never invent, estimate or assume financial figures: every number must come from a tool result or from the user.
If the ledger has no data for a question, say so plainly and suggest adding transactions.
Use the calculate tool for arithmetic. You have read-only access. Never claim to create or change records. Ask the user to use the ledger forms for changes.
Format answers in clean Markdown, with tables and bullet points where helpful. ${MODE_HINT[mode] ?? MODE_HINT.Balanced}`,
      },
    ],
  };

  const contents: any[] = history.slice(-40).map((t) => ({ role: t.role === "ai" ? "model" : "user", parts: [{ text: t.text }] }));
  const toolCalls: AgentResponse["toolCalls"] = [];
  const actionsTaken: string[] = [];

  const call = (m: string) =>
    fetch(`${API_ROOT}/${m}:generateContent`, {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ systemInstruction, contents, tools: [{ functionDeclarations: GEMINI_TOOLS }] }),
    });

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let response: Response;
    try {
      response = await call(model);
      if ([429, 503].includes(response.status)) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        response = await call(model);
      }
    } catch {
      throw new AgentError("The AI service did not respond in time. Please try again.");
    }
    if (!response.ok) throw await failure(response);

    const data: any = await response.json();
    const parts: any[] = data.candidates?.[0]?.content?.parts;
    if (!parts) throw new AgentError("Gemini didn't return an answer. Try rephrasing your question.");

    const calls = parts.filter((p) => p.functionCall);
    if (calls.length === 0) {
      const text = parts.filter((p) => p.text).map((p) => p.text).join("\n").trim();
      if (!text) throw new AgentError("Gemini returned an empty answer. Try again.");
      return { thought: `Used ${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"} on your ledger.`, toolCalls, text, actionsTaken };
    }

    contents.push({ role: "model", parts });
    const responseParts: any[] = [];
    for (const { functionCall: fn } of calls) {
      const result = await executeTool(fn.name, fn.args);
      toolCalls.push({ tool: fn.name, args: fn.args, result });
      if (result?.success && result.message) actionsTaken.push(result.message);
      responseParts.push({ functionResponse: { name: fn.name, response: { output: result } } });
    }
    contents.push({ role: "user", parts: responseParts });
  }

  throw new AgentError("This question needed too many steps. Try asking something more specific.");
}
