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
const FALLBACK_MODEL = "gemini-3.5-flash-lite";
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
    name: "add_transaction",
    description: "Record a transaction in the ledger. Only use when the user explicitly asks to record one.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING", description: "Payee or customer name" },
        amount: { type: "NUMBER", description: "Amount: positive for income, negative for an expense" },
        category: { type: "STRING", description: "Category, e.g. Sales, Services, Payroll, Software, Marketing, Travel, Office" },
        memo: { type: "STRING", description: "Description or purpose" },
        date: { type: "STRING", description: "ISO date YYYY-MM-DD. Defaults to today." },
      },
      required: ["name", "amount", "category"],
    },
  },
  {
    name: "get_budgets_status",
    description: "List all budgets with this month's spending and utilization.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "create_budget",
    description: "Create a monthly budget for a category. Only use when the user explicitly asks.",
    parameters: {
      type: "OBJECT",
      properties: {
        category: { type: "STRING", description: "Category name" },
        budget: { type: "NUMBER", description: "Monthly budget amount" },
        owner: { type: "STRING", description: "Team or person responsible" },
      },
      required: ["category", "budget"],
    },
  },
  {
    name: "create_goal",
    description: "Create a financial goal. Only use when the user explicitly asks.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING", description: "Goal title" },
        type: { type: "STRING", description: "Savings target, Revenue target, or Expense reduction" },
        target: { type: "NUMBER", description: "Target amount" },
        current: { type: "NUMBER", description: "Current amount" },
        date: { type: "STRING", description: "Target date YYYY-MM-DD" },
      },
      required: ["name", "target", "date"],
    },
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
  add_transaction: "addTransaction",
  get_budgets_status: "getBudgetsStatus",
  create_budget: "createBudget",
  create_goal: "createGoal",
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
  const body: any = await response.json().catch(() => ({}));
  const detail = body?.error?.message || response.statusText;
  if (response.status === 400 && /api key/i.test(detail)) return new AgentError(`Google rejected the Gemini API key: ${detail}`);
  if (response.status === 401 || response.status === 403) return new AgentError(`Google rejected the Gemini API key: ${detail} Create a new key at https://aistudio.google.com/apikey, put it in apps/web/.env.local as GEMINI_API_KEY, and try again.`);
  if (response.status === 429) return new AgentError(`Gemini's rate limit or quota was reached: ${detail}`);
  if (response.status === 404) return new AgentError(`Gemini couldn't find this model. Check GEMINI_MODEL in apps/web/.env.local. ${detail}`);
  return new AgentError(`Gemini returned an error (${response.status}): ${detail}`);
}

/** Runs the tool-calling loop. `history` is the conversation so far and must end with the user's new message. */
export async function runFinancialAgent(history: ChatTurn[], mode: string = "Balanced"): Promise<AgentResponse> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey || apiKey.includes("your_")) {
    throw new AgentError("The AI isn't connected yet. Add GEMINI_API_KEY to apps/web/.env.local and try again.");
  }
  const dailyLimit = Number(process.env.AI_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT;
  if ((await db.rpc<number>("bump_ai_usage")) > dailyLimit) {
    throw new AgentError(`You've reached today's limit of ${dailyLimit} AI requests. It resets at midnight UTC.`, 429);
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";

  const today = new Date().toISOString().split("T")[0];
  const systemInstruction = {
    parts: [
      {
        text: `You are Fremwork AI, a financial copilot for founders, CFOs and accountants. Today is ${today}.
Use your tools to read the user's real ledger. Never invent, estimate or assume financial figures: every number must come from a tool result or from the user.
If the ledger has no data for a question, say so plainly and suggest adding transactions.
Use the calculate tool for arithmetic. Only change data when the user explicitly asks you to.
Format answers in clean Markdown, with tables and bullet points where helpful. ${MODE_HINT[mode] ?? MODE_HINT.Balanced}`,
      },
    ],
  };

  const contents: any[] = history.map((t) => ({ role: t.role === "ai" ? "model" : "user", parts: [{ text: t.text }] }));
  const toolCalls: AgentResponse["toolCalls"] = [];
  const actionsTaken: string[] = [];

  const call = (m: string) =>
    fetch(`${API_ROOT}/${m}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ systemInstruction, contents, tools: [{ functionDeclarations: GEMINI_TOOLS }] }),
    });

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let response: Response;
    try {
      response = await call(model);
      if (response.status === 503 || response.status === 429) response = await call(FALLBACK_MODEL);
    } catch {
      throw new AgentError("Couldn't reach Gemini. Check your internet connection and try again.");
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
