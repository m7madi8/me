/**
 * Mohammad — personal AI advisor.
 * Local: Ollama + Qwen3 on this machine.
 * Online: Groq cloud (for use outside home).
 */

const DEFAULT_MODEL = "qwen3";
const MODEL_KEY = "mohammad-ollama-model";
const BASE_KEY = "mohammad-ollama-base";
const MODE_KEY = "mohammad-ai-mode"; // local | online | auto
const GROQ_KEY = "mohammad-groq-key";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

const OWNER = {
  name: "mohammad",
  atelier: "Mohammad",
  role: "مستقل تقني / بناء أنظمة ومنتجات رقمية للعملاء",
  region: "فلسطين / المنطقة (هواتف غالبًا +970، عملات $ أو ₪ أو JOD)",
  voice: "مباشر، عملي، بلا حشو. يخاطب محمد بصيغة المفرد.",
};

const STATUS_AR = {
  proposed: "مقترح",
  in_progress: "قيد التنفيذ",
  review: "قيد المراجعة",
  delivered: "تم التسليم",
  settled: "تمت التسوية",
};

/** Prefer Vite proxy in dev; direct localhost works from hosted site on same PC. */
function ollamaCandidates() {
  const saved = localStorage.getItem(BASE_KEY);
  const list = [];
  if (saved) list.push(saved);
  const host = window.location.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  if (isLocalHost) list.push("/ollama");
  list.push("http://127.0.0.1:11434", "http://localhost:11434");
  return [...new Set(list)];
}

async function fetchOllama(path, options) {
  let lastErr = null;
  for (const base of ollamaCandidates()) {
    try {
      const res = await fetch(`${base}${path}`, options);
      if (res.ok || res.status < 500) {
        localStorage.setItem(BASE_KEY, base);
        return res;
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Ollama unreachable");
}

export function getModel() {
  return localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL;
}

export function setModel(name) {
  localStorage.setItem(MODEL_KEY, (name || DEFAULT_MODEL).trim());
}

/** @returns {"local"|"online"|"auto"} */
export function getAiMode() {
  const m = localStorage.getItem(MODE_KEY);
  if (m === "local" || m === "online" || m === "auto") return m;
  return "auto";
}

export function setAiMode(mode) {
  if (mode === "local" || mode === "online" || mode === "auto") {
    localStorage.setItem(MODE_KEY, mode);
  }
}

export function getApiKey() {
  return (localStorage.getItem(GROQ_KEY) || import.meta.env.VITE_GROQ_API_KEY || "").trim();
}

export function setApiKey(key) {
  const v = (key || "").trim();
  if (v) localStorage.setItem(GROQ_KEY, v);
  else localStorage.removeItem(GROQ_KEY);
}

export async function ensureApiKeySeeded() {
  return ensureLocalAI();
}

export async function ensureLocalAI() {
  const mode = getAiMode();

  if (mode === "online") {
    if (getApiKey()) {
      localStorage.setItem("mohammad-ollama-ready", "1");
      return { ok: true, channel: "online", message: "جاهز أونلاين عبر Groq" };
    }
    localStorage.removeItem("mohammad-ollama-ready");
    return {
      ok: false,
      channel: "online",
      message: "أضف مفتاح Groq في الإعدادات (أو VITE_GROQ_API_KEY في .env ثم أعد البناء).",
    };
  }

  const local = await pingOllama();
  if (local.ok) {
    localStorage.setItem("mohammad-ollama-ready", "1");
    return { ...local, channel: "local" };
  }

  if (mode === "auto" && getApiKey()) {
    localStorage.setItem("mohammad-ollama-ready", "1");
    return {
      ok: true,
      channel: "online",
      message: "المحلي غير متاح — سيستخدم الأونلاين (Groq) خارج البيت.",
    };
  }

  localStorage.removeItem("mohammad-ollama-ready");
  return { ...local, channel: "local" };
}

export async function pingOllama() {
  try {
    const res = await fetchOllama("/api/tags", { method: "GET" });
    if (!res.ok) {
      return { ok: false, message: "Ollama يعمل لكن الرد غير سليم. تأكد أن الخدمة شغّالة." };
    }
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    const wanted = getModel();
    const hasModel = models.some(
      (n) => n === wanted || n.startsWith(`${wanted}:`) || n.split(":")[0] === wanted.split(":")[0]
    );
    if (!hasModel) {
      return {
        ok: false,
        models,
        message: `Ollama متصل، لكن النموذج «${wanted}» غير محمّل. نفّذ:\nollama pull ${wanted}`,
      };
    }
    localStorage.setItem("mohammad-ollama-ready", "1");
    const base = localStorage.getItem(BASE_KEY) || "local";
    return { ok: true, models, message: `جاهز محليًا — ${wanted}\n(${base})` };
  } catch (_) {
    const hosted = !["localhost", "127.0.0.1"].includes(window.location.hostname);
    return {
      ok: false,
      models: [],
      message: hosted
        ? "Ollama غير متصل على هذا الجهاز.\nللعمل خارج البيت: اختر «أونلاين» أو «تلقائي» وأضف مفتاح Groq."
        : "Ollama غير متصل. شغّله محليًا ثم:\nollama pull qwen3\nأو فعّل الأونلاين بمفتاح Groq.",
    };
  }
}

function projectPaid(p) {
  const payments = Array.isArray(p?.payments) ? p.payments : [];
  if (payments.length > 0) {
    return payments.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  }
  return Number(p?.paid) || 0;
}

function money(n, currency) {
  return `${(Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currency}`;
}

function stripThink(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s+/, "")
    .trim();
}

export function buildLedgerSnapshot(projects, userName = OWNER.name) {
  const list = Array.isArray(projects) ? projects : [];

  const byCurrency = {};
  for (const p of list) {
    const c = p.currency || "$";
    if (!byCurrency[c]) byCurrency[c] = { contracted: 0, paid: 0, costs: 0 };
    byCurrency[c].contracted += Number(p.totalPrice) || 0;
    byCurrency[c].paid += projectPaid(p);
    byCurrency[c].costs += Number(p.costs) || 0;
  }

  const byStatus = list.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});

  const entries = list
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map((p, i) => {
      const contracted = Number(p.totalPrice) || 0;
      const paid = projectPaid(p);
      const costs = Number(p.costs) || 0;
      const cur = p.currency || "$";
      const openReqs = (p.requests || []).filter((r) => !r.done);
      const payments = Array.isArray(p.payments) ? p.payments : [];
      return {
        index: i + 1,
        name: p.name || "بدون عنوان",
        client: p.client || "بدون عميل",
        phone: p.phone || "",
        status: STATUS_AR[p.status] || p.status,
        currency: cur,
        contracted,
        paid,
        costs,
        balanceDue: contracted - paid,
        profit: paid - costs,
        notes: (p.notes || "").slice(0, 180),
        openRequests: openReqs.map((r) => r.text).slice(0, 6),
        paymentCount: payments.length,
        lastPayments: payments.slice(0, 4).map((pay) => ({
          amount: Number(pay.amount) || 0,
          note: pay.note || "",
        })),
      };
    });

  return {
    owner: userName || OWNER.name,
    byCurrency,
    counts: { projects: list.length, byStatus },
    entries,
  };
}

function snapshotText(snap) {
  const totalLines = Object.entries(snap.byCurrency || {}).map(([c, t]) => {
    const outstanding = t.contracted - t.paid;
    const profit = t.paid - t.costs;
    return `عملة ${c}: متعاقد ${money(t.contracted, c)} | مستلم ${money(t.paid, c)} | متبقي ${money(outstanding, c)} | صافي ${money(profit, c)}`;
  });

  const lines = [
    `المالك: ${snap.owner}`,
    `عدد المشاريع: ${snap.counts.projects}`,
    ...(totalLines.length ? totalLines : ["لا مجاميع بعد"]),
    `حسب الحالة: ${Object.entries(snap.counts.byStatus)
      .map(([k, v]) => `${STATUS_AR[k] || k}=${v}`)
      .join("، ") || "لا شيء"}`,
    "",
    "المشاريع:",
  ];

  if (!snap.entries.length) {
    lines.push("- السجل فارغ.");
  } else {
    snap.entries.forEach((e) => {
      const c = e.currency || "$";
      lines.push(
        `- #${e.index} «${e.name}» | ${e.client} | ${e.status} | عملة ${c} | عقد ${money(e.contracted, c)} | مدفوع ${money(e.paid, c)} | متبقي ${money(e.balanceDue, c)} | ربح ${money(e.profit, c)}${e.phone ? ` | هاتف ${e.phone}` : ""}`
      );
      if (e.paymentCount) {
        const detail = (e.lastPayments || [])
          .map((pay) => `${money(pay.amount, c)}${pay.note ? `(${pay.note})` : ""}`)
          .join("، ");
        lines.push(`  دفعات (${e.paymentCount}): ${detail}`);
      }
      if (e.openRequests.length) lines.push(`  طلبات مفتوحة: ${e.openRequests.join("؛ ")}`);
      if (e.notes) lines.push(`  ملاحظات: ${e.notes}`);
    });
  }

  const due = snap.entries.filter((e) => e.balanceDue > 0).sort((a, b) => b.balanceDue - a.balanceDue);
  if (due.length) {
    lines.push("", "أعلى المستحقات:");
    due.slice(0, 5).forEach((e) => {
      lines.push(`- ${e.name} (${e.client}): ${money(e.balanceDue, e.currency || "$")}`);
    });
  }

  return lines.join("\n");
}

function systemPrompt(snap) {
  return `أنت «مستشار Mohammad» — المساعد الشخصي الحصري لـ ${snap.owner}.
لا تخدم أي شخص آخر. كل إجاباتك لمحمد فقط («أنت»، «عندك»، «حرّك»).

هويتك:
- مستشار أعمال وتشغيل لمستقل يبني أنظمة ومنتجات للعملاء.
- مصدر الحقيقة الوحيد: سجل Mohammad المعطى أدناه — لا تخترع أرقامًا أو مشاريع.
- المنطقة: ${OWNER.region}.
- الأسلوب: ${OWNER.voice} عربية واضحة. ممنوع الإنجليزية إلا لأسماء مشاريع/أدوات.

قواعد الدقة:
1) استخدم فقط بيانات اللقطة. إن نقصت معلومة، صرّح بذلك.
2) اربط كل توصية بمشروع أو رقم محدد.
3) الأولوية: تحصيل المستحقات → إغلاق الطلبات → تحويل المقترح لتنفيذ → خفض التكاليف.
4) إذا السجل فارغ، اقترح خطوة أولى عملية.
5) لا تكرر كلامًا عامًا بدون فعل محدد.

لقطة السجل:
${snapshotText(snap)}`;
}

async function callLocal(messages, { temperature = 0.35, maxTokens = 1400 } = {}) {
  const model = getModel();
  let res;
  try {
    res = await fetchOllama("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens,
        },
      }),
    });
  } catch (_) {
    throw new Error("تعذّر الاتصال بـ Ollama المحلي على هذا الجهاز.");
  }

  if (!res.ok) {
    let detail = `Ollama رفض الطلب (${res.status})`;
    try {
      const err = await res.json();
      detail = err.error || detail;
    } catch (_) {}
    if (String(detail).toLowerCase().includes("not found")) {
      detail = `النموذج «${model}» غير موجود. نفّذ: ollama pull ${model}`;
    }
    throw new Error(detail);
  }

  const data = await res.json();
  const text = stripThink(data.message?.content || data.response || "");
  if (!text) throw new Error("رد فارغ من Qwen3 المحلي");
  localStorage.setItem("mohammad-ollama-ready", "1");
  return text;
}

async function callOnline(messages, { temperature = 0.35, maxTokens = 1400 } = {}) {
  const key = getApiKey();
  if (!key) {
    throw new Error("مفتاح Groq غير موجود. أضفه من الإعدادات أو من console.groq.com");
  }

  let res;
  try {
    res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });
  } catch (_) {
    throw new Error("تعذّر الاتصال بـ Groq. تحقق من الإنترنت.");
  }

  if (!res.ok) {
    let detail = `Groq رفض الطلب (${res.status})`;
    try {
      const err = await res.json();
      detail = err.error?.message || err.error || detail;
    } catch (_) {}
    if (res.status === 401) detail = "مفتاح Groq غير صالح. أنشئ مفتاحًا جديدًا من console.groq.com";
    throw new Error(detail);
  }

  const data = await res.json();
  const text = stripThink(data.choices?.[0]?.message?.content || "");
  if (!text) throw new Error("رد فارغ من Groq");
  return text;
}

/** Route by mode: local | online | auto (local then online). */
async function callAI(messages, opts = {}) {
  const mode = getAiMode();

  if (mode === "online") return callOnline(messages, opts);
  if (mode === "local") return callLocal(messages, opts);

  try {
    return await callLocal(messages, opts);
  } catch (localErr) {
    if (!getApiKey()) throw localErr;
    try {
      return await callOnline(messages, opts);
    } catch (onlineErr) {
      throw new Error(`${localErr.message}\n\nالأونلاين أيضًا فشل: ${onlineErr.message}`);
    }
  }
}

export async function getDailyBriefing(projects, userName = OWNER.name) {
  const snap = buildLedgerSnapshot(projects, userName);
  try {
    return await callAI(
      [
        { role: "system", content: systemPrompt(snap) },
        {
          role: "user",
          content: `أعطني إحاطة تشغيلية قصيرة الآن (أقصى 6 أسطر):
- سطر واحد: وضع السجل الحالي بجملة رقمية دقيقة.
- ثم 3 إلى 5 إجراءات مرتبة بالأولوية، كل سطر يبدأ بـ «→» ويذكر اسم مشروع/عميل أو رقمًا من السجل.
- لا مقدمة ولا خاتمة.`,
        },
      ],
      { temperature: 0.25, maxTokens: 700 }
    );
  } catch (error) {
    return `تعذّر جلب الإحاطة: ${error.message}`;
  }
}

export async function analyzeBusinessPerformance(projects, userName = OWNER.name) {
  const snap = buildLedgerSnapshot(projects, userName);
  try {
    return await callAI(
      [
        { role: "system", content: systemPrompt(snap) },
        {
          role: "user",
          content: `حلّل أداء أعمالي في سجل Mohammad بدقة:

1) التقييم العام بالأرقام من اللقطة
2) أين يتسرب المال أو الوقت
3) أقوى 3 فرص ربح/تحصيل هذا الأسبوع
4) مخاطر واضحة إن وُجدت
5) خطة عمل لـ 7 أيام

اكتب بالعربية، منظمًا بعناوين قصيرة.`,
        },
      ],
      { temperature: 0.3, maxTokens: 1600 }
    );
  } catch (error) {
    return `خطأ في التحليل: ${error.message}`;
  }
}

export async function getProjectRecommendations(project, allProjects = [], userName = OWNER.name) {
  const snap = buildLedgerSnapshot(allProjects.length ? allProjects : [project], userName);
  const currency = project.currency || "$";
  const balance = (Number(project.totalPrice) || 0) - projectPaid(project);
  const profit = projectPaid(project) - (Number(project.costs) || 0);
  const openReqs = (project.requests || []).filter((r) => !r.done);

  try {
    return await callAI(
      [
        { role: "system", content: systemPrompt(snap) },
        {
          role: "user",
          content: `ركّز على هذا المشروع فقط وقدّم توصيات عملية:

المشروع: ${project.name || "بدون عنوان"}
العميل: ${project.client || "غير محدد"}
الهاتف: ${project.phone || "غير متوفر"}
الحالة: ${STATUS_AR[project.status] || project.status}
العقد: ${money(project.totalPrice, currency)}
المستلم: ${money(projectPaid(project), currency)}
التكاليف: ${money(project.costs, currency)}
المستحق: ${money(balance, currency)}
الربح الحالي: ${money(profit, currency)}
ملاحظات: ${project.notes || "لا يوجد"}
طلبات مفتوحة: ${openReqs.map((r) => r.text).join("؛ ") || "لا يوجد"}

المطلوب:
- تشخيص سطر واحد
- 4 إجراءات مرتبة
- جملة واتساب جاهزة إن لزم (عربية، مهذبة ومباشرة)`,
        },
      ],
      { temperature: 0.35, maxTokens: 1200 }
    );
  } catch (error) {
    return `خطأ: ${error.message}`;
  }
}

export async function chatWithAI(projects, userName, userMessage, history = [], selectedProject = null) {
  const snap = buildLedgerSnapshot(projects, userName);
  const focus = selectedProject
    ? `\nالمشروع المفتوح الآن: «${selectedProject.name || "بدون عنوان"}» — ${selectedProject.client || "بدون عميل"} — ${STATUS_AR[selectedProject.status] || selectedProject.status}.`
    : "";

  const messages = [
    { role: "system", content: systemPrompt(snap) + focus },
    ...history.slice(-12).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  try {
    return await callAI(messages, { temperature: 0.4, maxTokens: 1200 });
  } catch (error) {
    return `خطأ: ${error.message}`;
  }
}

export async function draftWhatsAppFollowUp(project, userName = OWNER.name) {
  const snap = buildLedgerSnapshot([project], userName);
  const currency = project.currency || "$";
  const balance = (Number(project.totalPrice) || 0) - projectPaid(project);
  try {
    return await callAI(
      [
        { role: "system", content: systemPrompt(snap) },
        {
          role: "user",
          content: `اكتب رسالة واتساب واحدة فقط من ${userName} إلى العميل «${project.client || "العميل"}» بخصوص مشروع «${project.name || "المشروع"}».
المستحق: ${money(balance, currency)}. الحالة: ${STATUS_AR[project.status] || project.status}.
الشروط: رسالة قصيرة (3–6 أسطر)، ودّية ومهنية، جاهزة للنسخ كما هي، بدون عنوان أو شرح إضافي.`,
        },
      ],
      { temperature: 0.5, maxTokens: 400 }
    );
  } catch (error) {
    return `تعذّر إنشاء الرسالة: ${error.message}`;
  }
}

export { OWNER, DEFAULT_MODEL, GROQ_MODEL };
