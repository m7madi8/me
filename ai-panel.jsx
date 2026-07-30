import React, { useEffect, useRef, useState } from "react";
import { Brain, MessageSquare, Settings, Sparkles, RefreshCw, Copy, Check, ArrowUp } from "lucide-react";
import {
  analyzeBusinessPerformance,
  getProjectRecommendations,
  chatWithAI,
  getDailyBriefing,
  draftWhatsAppFollowUp,
  ensureLocalAI,
  getModel,
  setModel,
  DEFAULT_MODEL,
  OWNER,
} from "./ai-service.js";
import logoMe from "./img/logo-me.webp";

/**
 * ChatGPT-style local advisor (Ollama + Qwen3).
 */
export default function AIAdvisorPage({
  projects,
  currency,
  userName,
  setUserName,
  selectedId,
  setSelectedId,
  aiReady,
  setAiReady,
}) {
  const [tab, setTab] = useState("chat");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [briefing, setBriefing] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [projectAdvice, setProjectAdvice] = useState("");
  const [waDraft, setWaDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [modelName, setModelName] = useState(getModel());
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const chatEndRef = useRef(null);
  const briefOnce = useRef(false);
  const inputRef = useRef(null);

  const selected = projects.find((p) => p.id === selectedId) || null;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, loading]);

  useEffect(() => {
    if (tab === "briefing" && !briefOnce.current && aiReady) {
      briefOnce.current = true;
      refreshBriefing();
    }
  }, [tab, aiReady]);

  useEffect(() => {
    refreshStatus();
  }, []);

  async function refreshStatus() {
    const status = await ensureLocalAI();
    setAiReady(!!status.ok);
    setStatusMsg(status.message || "");
    return status;
  }

  function requireLocal() {
    if (!aiReady) {
      setTab("settings");
      setError("Qwen3 غير جاهز. ثبّت Ollama ثم افحص الاتصال.");
      return false;
    }
    setError("");
    return true;
  }

  async function refreshBriefing() {
    if (!requireLocal()) return;
    setLoading(true);
    try {
      setBriefing(await getDailyBriefing(projects, currency, userName));
    } catch (e) {
      setBriefing(`تعذّر جلب الإحاطة: ${e.message}`);
    }
    setLoading(false);
  }

  async function runAnalysis() {
    if (!requireLocal()) return;
    setLoading(true);
    setTab("analysis");
    try {
      setAnalysis(await analyzeBusinessPerformance(projects, currency, userName));
    } catch (e) {
      setAnalysis(`حدث خطأ: ${e.message}`);
    }
    setLoading(false);
  }

  async function runProjectAdvice() {
    if (!requireLocal() || !selected) return;
    setLoading(true);
    try {
      setProjectAdvice(await getProjectRecommendations(selected, currency, userName));
    } catch (e) {
      setProjectAdvice(`حدث خطأ: ${e.message}`);
    }
    setLoading(false);
  }

  async function runWaDraft() {
    if (!requireLocal() || !selected) return;
    setLoading(true);
    try {
      setWaDraft(await draftWhatsAppFollowUp(selected, userName));
    } catch (e) {
      setWaDraft(`حدث خطأ: ${e.message}`);
    }
    setLoading(false);
  }

  async function sendChat(text) {
    const q = (typeof text === "string" ? text : chatInput).trim();
    if (!q || loading) return;
    if (!requireLocal()) return;

    const history = chatMessages;
    setChatInput("");
    setChatMessages((m) => [...m, { role: "user", content: q }]);
    setLoading(true);
    try {
      const reply = await chatWithAI(projects, currency, userName, q, history, selected);
      setChatMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (e) {
      setChatMessages((m) => [...m, { role: "assistant", content: `تعذّر الرد: ${e.message}` }]);
    }
    setLoading(false);
    inputRef.current?.focus();
  }

  async function saveSettings() {
    setModel(modelName.trim() || DEFAULT_MODEL);
    setModelName(getModel());
    setLoading(true);
    const status = await refreshStatus();
    setLoading(false);
    if (status.ok) {
      setError("");
      setTab("chat");
    } else {
      setError(status.message);
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (_) {}
  }

  const chips = [
    "شو أهم خطوة اليوم؟",
    "مين لازم أحصّل منه أول؟",
    "وين في تسريب فلوس أو وقت؟",
    selected ? `كيف أمشي بمشروع ${selected.name || "المفتوح"}؟` : null,
  ].filter(Boolean);

  const tools = [
    { id: "chat", icon: MessageSquare, title: "محادثة" },
    { id: "briefing", icon: Sparkles, title: "إحاطة" },
    { id: "analysis", icon: Brain, title: "تحليل" },
    { id: "project", icon: MessageSquare, title: "مشروع" },
    { id: "settings", icon: Settings, title: "إعدادات" },
  ];

  return (
    <div className="ai-page gpt-chat fade-in" dir="rtl">
      <nav className="ai-rail" aria-label="أدوات">
        {tools.map(({ id, icon: Icon, title }) => (
          <button
            key={id}
            type="button"
            className={`ai-rail-btn ${tab === id ? "is-active" : ""}`}
            onClick={() => setTab(id)}
            title={title}
            aria-label={title}
          >
            <Icon size={18} />
          </button>
        ))}
        <span className={`ai-dot ${aiReady ? "on" : ""}`} title={aiReady ? "محلي جاهز" : "غير متصل"} />
      </nav>

      {error && <div className="ai-error soft">{error}</div>}

      <div className="ai-body-wrap">
        {tab === "chat" && (
          <section className="ai-panel chat-panel gpt">
            <div className="ai-panel-scroll mh-scroll">
              {chatMessages.length === 0 && (
                <div className="chat-empty gpt">
                  <img src={logoMe} alt="" className="chat-empty-logo" />
                  <h2>كيف أقدر أساعدك؟</h2>
                  <div className="chip-row">
                    {chips.map((q) => (
                      <button key={q} type="button" className="chip soft" onClick={() => sendChat(q)} disabled={loading}>
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`chat-row ${msg.role === "user" ? "is-user" : "is-ai"}`}>
                  {msg.role !== "user" && (
                    <img src={logoMe} alt="" className="chat-avatar" />
                  )}
                  <div className={`chat-bubble gpt ${msg.role === "user" ? "is-user" : "is-ai"}`}>
                    <div className="chat-text">{msg.content}</div>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="chat-row is-ai">
                  <img src={logoMe} alt="" className="chat-avatar" />
                  <div className="typing-dots" aria-label="يكتب">
                    <span /><span /><span />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="chat-compose gpt sticky-compose">
              <div className="composer">
                <textarea
                  ref={inputRef}
                  className="composer-input"
                  rows={1}
                  placeholder="اكتب رسالة…"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendChat();
                    }
                  }}
                />
                <button
                  className="composer-send"
                  type="button"
                  onClick={() => sendChat()}
                  disabled={loading || !chatInput.trim()}
                  aria-label="إرسال"
                >
                  <ArrowUp size={18} strokeWidth={2.4} />
                </button>
              </div>
            </div>
          </section>
        )}

        {tab === "briefing" && (
          <section className="ai-panel soft-panel">
            <div className="ai-panel-toolbar quiet">
              <button className="btn-ghost" type="button" onClick={refreshBriefing} disabled={loading}>
                <RefreshCw size={14} />
                {loading ? "…" : "حدّث"}
              </button>
            </div>
            {loading && !briefing ? (
              <div className="loading-line"><span>لحظة…</span></div>
            ) : (
              <pre className="ai-prose">{briefing || "اضغط حدّث."}</pre>
            )}
          </section>
        )}

        {tab === "analysis" && (
          <section className="ai-panel soft-panel">
            <div className="ai-panel-toolbar quiet">
              <button className="btn-primary" type="button" onClick={runAnalysis} disabled={loading}>
                {loading ? "…" : analysis ? "أعد" : "حلّل"}
              </button>
            </div>
            {loading && !analysis ? (
              <div className="loading-line"><span>لحظة…</span></div>
            ) : (
              <pre className="ai-prose">{analysis || "اضغط حلّل."}</pre>
            )}
          </section>
        )}

        {tab === "project" && (
          <section className="ai-panel soft-panel">
            <label className="field">
              <select
                className="field-input"
                value={selectedId || ""}
                onChange={(e) => setSelectedId(e.target.value || null)}
              >
                <option value="">اختر مشروعاً</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {(p.name || "بدون عنوان") + (p.client ? ` — ${p.client}` : "")}
                  </option>
                ))}
              </select>
            </label>

            <div className="ai-actions" style={{ marginTop: 12 }}>
              <button className="btn-ghost" type="button" onClick={runProjectAdvice} disabled={loading || !selected}>
                توصيات
              </button>
              <button className="btn-ghost" type="button" onClick={runWaDraft} disabled={loading || !selected}>
                واتساب
              </button>
            </div>

            {loading && <div className="loading-line" style={{ marginTop: 20 }}><span>لحظة…</span></div>}
            {projectAdvice && <pre className="ai-prose" style={{ marginTop: 16 }}>{projectAdvice}</pre>}
            {waDraft && (
              <div style={{ marginTop: 16 }}>
                <button className="btn-ghost" type="button" onClick={() => copyText(waDraft)} style={{ marginBottom: 8 }}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "تم" : "نسخ"}
                </button>
                <pre className="ai-prose">{waDraft}</pre>
              </div>
            )}
          </section>
        )}

        {tab === "settings" && (
          <section className="ai-panel soft-panel form-stack">
            <label className="field">
              <input
                className="field-input"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder={OWNER.name}
              />
            </label>
            <label className="field">
              <input
                className="field-input"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder={DEFAULT_MODEL}
              />
            </label>
            {statusMsg && <div className={`ai-error soft ${aiReady ? "is-ok" : ""}`}>{statusMsg}</div>}
            <button className="btn-primary btn-block" type="button" onClick={saveSettings}>
              فحص الاتصال
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
