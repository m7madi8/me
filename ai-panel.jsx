import React, { useEffect, useRef, useState } from "react";
import { Brain, MessageSquare, Settings, Sparkles, RefreshCw, Copy, Check } from "lucide-react";
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

/**
 * Dedicated local AI workspace for mohammad (Ollama + Qwen3).
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
      setError("Qwen3 المحلي غير جاهز. ثبّت Ollama وسحب النموذج ثم اضغط «فحص الاتصال».");
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
    if (!requireLocal()) return;
    if (!selected) {
      setError("اختر مشروعًا من القائمة أولًا.");
      return;
    }
    setLoading(true);
    setTab("project");
    setError("");
    try {
      setProjectAdvice(await getProjectRecommendations(selected, currency, projects, userName));
    } catch (e) {
      setProjectAdvice(`حدث خطأ: ${e.message}`);
    }
    setLoading(false);
  }

  async function runWaDraft() {
    if (!requireLocal() || !selected) return;
    setLoading(true);
    setTab("project");
    try {
      setWaDraft(await draftWhatsAppFollowUp(selected, currency, userName));
    } catch (e) {
      setWaDraft(`حدث خطأ: ${e.message}`);
    }
    setLoading(false);
  }

  async function sendChat(preset) {
    const text = (preset || chatInput).trim();
    if (!text || !requireLocal()) return;
    const history = chatMessages;
    setChatMessages((prev) => [...prev, { role: "user", content: text }]);
    setChatInput("");
    setLoading(true);
    try {
      const reply = await chatWithAI(projects, currency, userName, text, history, selected);
      setChatMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (e) {
      setChatMessages((prev) => [...prev, { role: "assistant", content: `حدث خطأ: ${e.message}` }]);
    }
    setLoading(false);
  }

  async function saveSettings() {
    setModel(modelName.trim() || DEFAULT_MODEL);
    setModelName(getModel());
    const status = await refreshStatus();
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

  return (
    <div className="ai-page fade-in" dir="rtl">
      <header className="ai-hero">
        <div>
          <div className="ai-kicker">
            <Sparkles size={14} />
            محلي بالكامل — Ollama / Qwen3
          </div>
          <h2 className="ai-title">مستشار Mohammad</h2>
          <p className="ai-sub">
            مخصّص لـ {userName} فقط. يعمل على جهازك بدون إنترنت ويقرأ سجل Mohammad.
          </p>
        </div>
        <div className="ai-stats">
          <div>
            <span>المشاريع</span>
            <strong>{projects.length}</strong>
          </div>
          <div>
            <span>الحالة</span>
            <strong>{aiReady ? "محلي جاهز" : "غير متصل"}</strong>
          </div>
        </div>
      </header>

      <nav className="ai-tabs" aria-label="أقسام المستشار">
        {[
          { id: "chat", label: "محادثة", icon: MessageSquare },
          { id: "briefing", label: "إحاطة", icon: Sparkles },
          { id: "analysis", label: "تحليل", icon: Brain },
          { id: "project", label: "مشروع", icon: MessageSquare },
          { id: "settings", label: "محلي", icon: Settings },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`ai-tab ${tab === id ? "is-active" : ""}`}
            onClick={() => setTab(id)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </nav>

      {error && <div className="ai-error">{error}</div>}

      <div className="ai-body-wrap">
        {tab === "chat" && (
          <section className="ai-panel chat-panel">
            <div className="ai-panel-scroll mh-scroll">
              {chatMessages.length === 0 && (
                <div className="chat-empty">
                  <p className="chat-hint">ابدأ بسؤال مباشر. المستشار يعرف إدخالات سجلك محليًا.</p>
                  <div className="chip-row">
                    {chips.map((q) => (
                      <button key={q} type="button" className="chip" onClick={() => sendChat(q)} disabled={loading}>
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`chat-bubble ${msg.role === "user" ? "is-user" : "is-ai"}`}>
                  <div className="chat-role">{msg.role === "user" ? "أنت" : "مستشار Mohammad"}</div>
                  <div className="chat-text">{msg.content}</div>
                </div>
              ))}
              {loading && (
                <div className="loading-line">
                  <Sparkles size={16} className="spin" />
                  <span>Qwen3 يكتب محليًا…</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="chat-compose sticky-compose">
              <input
                className="field-input"
                placeholder="اكتب لمستشارك…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChat()}
              />
              <button className="btn-primary" type="button" onClick={() => sendChat()} disabled={loading}>
                إرسال
              </button>
            </div>
          </section>
        )}

        {tab === "briefing" && (
          <section className="ai-panel">
            <div className="ai-panel-toolbar">
              <h3>إحاطة اليوم</h3>
              <button className="btn-ghost" type="button" onClick={refreshBriefing} disabled={loading}>
                <RefreshCw size={14} />
                {loading ? "يحدّث…" : "حدّث"}
              </button>
            </div>
            {loading && !briefing ? (
              <div className="loading-line">
                <Sparkles size={16} className="spin" />
                <span>يقرأ السجل محليًا…</span>
              </div>
            ) : (
              <pre className="ai-prose">{briefing || "اضغط «حدّث» لجلب إحاطتك."}</pre>
            )}
          </section>
        )}

        {tab === "analysis" && (
          <section className="ai-panel">
            <div className="ai-panel-toolbar">
              <h3>تحليل الأعمال</h3>
              <button className="btn-primary" type="button" onClick={runAnalysis} disabled={loading}>
                <Brain size={14} />
                {loading ? "يحلّل…" : analysis ? "أعد التحليل" : "حلّل الآن"}
              </button>
            </div>
            {loading && !analysis ? (
              <div className="loading-line">
                <Sparkles size={16} className="spin" />
                <span>Qwen3 يحلّل…</span>
              </div>
            ) : (
              <pre className="ai-prose">{analysis || "شغّل التحليل لترى صورة كاملة عن أعمالك."}</pre>
            )}
          </section>
        )}

        {tab === "project" && (
          <section className="ai-panel">
            <div className="ai-panel-toolbar">
              <h3>تركيز على مشروع</h3>
            </div>

            <label className="field">
              <span className="field-label">اختر مشروعًا</span>
              <select
                className="field-input"
                value={selectedId || ""}
                onChange={(e) => setSelectedId(e.target.value || null)}
              >
                <option value="">— اختر —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {(p.name || "بدون عنوان") + (p.client ? ` — ${p.client}` : "")}
                  </option>
                ))}
              </select>
            </label>

            <div className="ai-actions" style={{ marginTop: 12 }}>
              <button className="btn-ghost" type="button" onClick={runProjectAdvice} disabled={loading || !selected}>
                <Brain size={14} /> توصيات المشروع
              </button>
              <button className="btn-ghost" type="button" onClick={runWaDraft} disabled={loading || !selected}>
                <MessageSquare size={14} /> مسودة واتساب
              </button>
            </div>

            {loading && (
              <div className="loading-line" style={{ marginTop: 20 }}>
                <Sparkles size={16} className="spin" />
                <span>يعمل محليًا…</span>
              </div>
            )}

            {projectAdvice && (
              <div style={{ marginTop: 18 }}>
                <div className="field-label" style={{ marginBottom: 8 }}>التوصيات</div>
                <pre className="ai-prose">{projectAdvice}</pre>
              </div>
            )}

            {waDraft && (
              <div style={{ marginTop: 18 }}>
                <div className="ai-panel-toolbar">
                  <div className="field-label">مسودة واتساب</div>
                  <button className="btn-ghost" type="button" onClick={() => copyText(waDraft)}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? "تم النسخ" : "نسخ"}
                  </button>
                </div>
                <pre className="ai-prose">{waDraft}</pre>
              </div>
            )}
          </section>
        )}

        {tab === "settings" && (
          <section className="ai-panel form-stack">
            <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontStyle: "italic" }}>
              التشغيل المحلي
            </h3>
            <p className="field-hint" style={{ marginTop: 0 }}>
              لا يوجد API سحابي. الذكاء الاصطناعي يعمل عبر Ollama على جهازك فقط.
            </p>

            <label className="field">
              <span className="field-label">اسمك</span>
              <input
                className="field-input"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder={OWNER.name}
              />
            </label>

            <label className="field">
              <span className="field-label">نموذج Ollama</span>
              <input
                className="field-input"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder={DEFAULT_MODEL}
              />
              <p className="field-hint">الافتراضي: qwen3 — بعد التثبيت مرة واحدة يعمل بدون نت.</p>
            </label>

            <pre className="ai-prose" style={{ opacity: 0.85, fontSize: 13 }}>
{`1) ثبّت Ollama من موقعه (مرة واحدة)
2) في الطرفية:
   ollama pull qwen3
3) اترك Ollama شغالًا
4) اضغط «فحص الاتصال»`}
            </pre>

            {statusMsg && <div className={`ai-error ${aiReady ? "is-ok" : ""}`}>{statusMsg}</div>}

            <button className="btn-primary btn-block" type="button" onClick={saveSettings}>
              فحص الاتصال وحفظ
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
