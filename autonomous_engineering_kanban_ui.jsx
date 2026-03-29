import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  GitPullRequest,
  MessageSquare,
  PlayCircle,
  Sparkles,
  Timer,
} from "lucide-react";

const notes = [
  "build a tiny crypto alert app for me",
  "local first, no auth",
  "desktop alerts matter more than polish",
  "use Claude Code first, Codex only if needed",
];

const chat = [
  {
    who: "you",
    text: "I want a small personal app. Track a few coins, set price thresholds, send desktop alerts.",
  },
  {
    who: "agent",
    text: "I’ll keep this lean. I can turn it into a tight v1 PRD, then split only the tasks that are small enough to finish cleanly.",
  },
  {
    who: "you",
    text: "Good. Keep it cheap and don’t make a giant plan.",
  },
  {
    who: "agent",
    text: "Understood. One active task at a time, small queue, human approval before merge.",
  },
];

const prd = {
  title: "Crypto Threshold Notifier v1",
  summary:
    "A local-first personal app that watches selected assets and sends desktop alerts when thresholds are crossed.",
  scope: [
    "Watchlist for up to 6 assets",
    "Upper and lower threshold rules",
    "Desktop notifications",
    "Simple local settings",
  ],
};

const tasks = [
  { id: "T-11", title: "Create local settings store", status: "next" },
  { id: "T-12", title: "Build threshold form UI", status: "queued" },
  { id: "T-13", title: "Wire desktop notifications", status: "queued" },
];

const currentRun = {
  id: "T-10",
  title: "Scaffold app shell and watchlist screen",
  agent: "Claude Code",
  stage: "Running lint + tests",
  progress: 68,
  pr: "Draft PR after checks",
};

const recent = [
  { id: "T-08", title: "Set up local state", pr: "#42" },
  { id: "T-09", title: "Add asset picker", pr: "#43" },
];

function Pill({ children, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Card({ children, className = "" }) {
  return <div className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

export default function AutonomousEngineeringKanbanUI() {
  const [view, setView] = useState("chat");
  const [approved, setApproved] = useState(false);

  const nextTask = useMemo(() => tasks.find((task) => task.status === "next"), []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl p-5 md:p-8">
        <div className="mb-6 rounded-[32px] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 text-white shadow-2xl md:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 flex flex-wrap gap-2">
                <Pill tone="blue">Scratch Pad</Pill>
                <Pill tone="green">idea → plan → build</Pill>
              </div>
              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Scratch Pad</h1>
              <p className="mt-3 text-sm leading-6 text-slate-300 md:text-base">
                Dump a rough idea, shape it with your agent, approve the plan, and let it keep moving one task at a time.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                <div className="text-xs text-slate-300">Current agent</div>
                <div className="mt-1 text-lg font-semibold">Claude Code</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                <div className="text-xs text-slate-300">Budget</div>
                <div className="mt-1 text-lg font-semibold">46% used</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                <div className="text-xs text-slate-300">Mode</div>
                <div className="mt-1 text-lg font-semibold">Sequential</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr_0.7fr]">
          <div className="space-y-6">
            <Card className="p-5 md:p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Scratch</h2>
                  <p className="text-sm text-slate-500">Start messy. No structure required.</p>
                </div>
                <Pill tone="blue">notes</Pill>
              </div>

              <div className="mb-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                build a tiny crypto alert app for me. local first. very simple. don’t overbuild it.
              </div>

              <div className="flex flex-wrap gap-2">
                {notes.map((note) => (
                  <span key={note} className="rounded-full bg-slate-100 px-3 py-2 text-sm text-slate-700">
                    {note}
                  </span>
                ))}
              </div>
            </Card>

            <Card className="p-5 md:p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Talk to agent</h2>
                  <p className="text-sm text-slate-500">Use chat to shape the idea before it becomes work.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setView("chat")}
                    className={`rounded-xl px-3 py-2 text-sm ${view === "chat" ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-700"}`}
                  >
                    Chat
                  </button>
                  <button
                    onClick={() => setView("plan")}
                    className={`rounded-xl px-3 py-2 text-sm ${view === "plan" ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-700"}`}
                  >
                    Plan
                  </button>
                </div>
              </div>

              {view === "chat" ? (
                <div className="space-y-3">
                  {chat.map((msg, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-6 ${msg.who === "you" ? "ml-auto bg-slate-900 text-white" : "border border-slate-200 bg-slate-50 text-slate-700"}`}
                    >
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">{msg.who}</div>
                      {msg.text}
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-slate-900">{prd.title}</div>
                      <div className="mt-1 text-sm leading-6 text-slate-600">{prd.summary}</div>
                    </div>
                    <Pill tone={approved ? "green" : "amber"}>{approved ? "approved" : "awaiting approval"}</Pill>
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Scope</div>
                    <div className="space-y-2 text-sm text-slate-600">
                      {prd.scope.map((item) => (
                        <div key={item} className="flex items-start gap-2">
                          <ChevronRight className="mt-1 h-4 w-4 text-slate-400" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => setApproved((v) => !v)}
                      className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                    >
                      {approved ? "Approved" : "Approve plan"}
                    </button>
                    <button className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      Ask for smaller v1
                    </button>
                  </div>
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="p-5 md:p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Build queue</h2>
                  <p className="text-sm text-slate-500">Small tasks only. One active task at a time.</p>
                </div>
                <Pill tone="green">next up {nextTask?.id}</Pill>
              </div>

              <div className="space-y-3">
                {tasks.map((task) => (
                  <div key={task.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold tracking-wide text-slate-500">{task.id}</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{task.title}</div>
                      </div>
                      <Pill tone={task.status === "next" ? "green" : task.status === "queued" ? "blue" : "amber"}>
                        {task.status}
                      </Pill>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5 md:p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Current run</h2>
                  <p className="text-sm text-slate-500">What the agent is doing right now.</p>
                </div>
                <Pill tone="blue">{currentRun.agent}</Pill>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="mb-1 text-xs font-semibold tracking-wide text-slate-500">{currentRun.id}</div>
                <div className="text-sm font-semibold text-slate-900">{currentRun.title}</div>

                <div className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-700">
                  <PlayCircle className="h-4 w-4 text-slate-700" />
                  {currentRun.stage}
                </div>

                <div className="mt-3 h-2 rounded-full bg-slate-200">
                  <div className="h-2 rounded-full bg-slate-900" style={{ width: `${currentRun.progress}%` }} />
                </div>

                <div className="mt-3 text-sm text-slate-500">{currentRun.progress}% complete</div>
                <div className="mt-2 rounded-xl bg-white px-3 py-2 text-sm text-slate-600">{currentRun.pr}</div>
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="p-5 md:p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">At a glance</h2>
                  <p className="text-sm text-slate-500">Only the few things you actually need.</p>
                </div>
                <Sparkles className="h-5 w-5 text-slate-400" />
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-xs text-slate-500">Approval</div>
                  <div className="mt-1 flex items-center gap-2 text-sm font-medium text-slate-800">
                    <FileText className="h-4 w-4" />
                    {approved ? "Plan approved" : "Waiting on you"}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-xs text-slate-500">Budget</div>
                  <div className="mt-1 flex items-center gap-2 text-sm font-medium text-slate-800">
                    <Timer className="h-4 w-4" />
                    46% used today
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-xs text-slate-500">Next action</div>
                  <div className="mt-1 flex items-center gap-2 text-sm font-medium text-slate-800">
                    <ArrowRight className="h-4 w-4" />
                    {approved ? "Keep draining queue" : "Approve the plan"}
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-5 md:p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Recent output</h2>
                  <p className="text-sm text-slate-500">Finished work, not a whole dashboard.</p>
                </div>
                <GitPullRequest className="h-5 w-5 text-slate-400" />
              </div>

              <div className="space-y-3">
                {recent.map((item) => (
                  <div key={item.id} className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-xs font-semibold tracking-wide text-slate-500">{item.id}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{item.title}</div>
                    <div className="mt-2 inline-flex items-center gap-2 text-sm text-slate-600">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      {item.pr}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-slate-100 p-5 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <Bot className="h-5 w-5 text-slate-700" />
                <div className="font-semibold text-slate-900">Why this feels lighter</div>
              </div>
              <p className="text-sm leading-6 text-slate-600">
                It behaves like a notes app that can turn into an execution loop, not like a PM system asking you to manage process.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
