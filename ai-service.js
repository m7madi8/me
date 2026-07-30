/**
 * Mohammad — personal local AI advisor.
 * Runs fully offline via Ollama + Qwen3 on this machine.
 */

const DEFAULT_MODEL = "qwen3";
const MODEL_KEY = "mohammad-ollama-model";
const BASE_KEY = "mohammad-ollama-base";

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

/** Compatibility: "ready" means local Ollama answered. */
export function getApiKey() {
  return localStorage.getItem("mohammad-ollama-ready") === "1" ? "local" : "";
}

export function setApiKey() {
  /* no cloud key — local only */
}

export async function ensureApiKeySeeded() {
  return ensureLocalAI();
}

export async function ensureLocalAI() {
  const status = await pingOllama();
  if (status.ok) localStorage.setItem("mohammad-ollama-ready", "1");
  else localStorage.removeItem("mohammad-ollama-ready");
  return status;
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
        ? "من الرابط المنشور: شغّل Ollama على هذا الجهاز، ثم في PowerShell مرة واحدة:\nsetx OLLAMA_ORIGINS \"*\"\nوأعد تشغيل Ollama، ثم اضغط فحص الاتصال."
        : "Ollama غير متصل. شغّله محليًا ثم:\nollama pull qwen3",
    };
  }
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

export function buildLedgerSnapshot(projects, currency, userName = OWNER.name) {
  const list = Array.isArray(projects) ? projects : [];
  const totals = {
    contracted: list.reduce((s, p) => s + (Number(p.totalPrice) || 0), 0),
    paid: list.reduce((s, p) => s + (Number(p.paid) || 0), 0),
    costs: list.reduce((s, p) => s + (Number(p.costs) || 0), 0),
  };
  totals.outstanding = totals.contracted - totals.paid;
  totals.profit = totals.paid - totals.costs;

  const byStatus = list.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});

  const entries = list
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map((p, i) => {
      const contracted = Number(p.totalPrice) || 0;
      const paid = Number(p.paid) || 0;
      const costs = Number(p.costs) || 0;
      const openReqs = (p.requests || []).filter((r) => !r.done);
      return {
        index: i + 1,
        name: p.name || "بدون عنوان",
        client: p.client || "بدون عميل",
        phone: p.phone || "",
        status: p.status,
        statusAr: STATUS_AR[p.status] || p.status,
        contracted,
        paid,
        costs,
        balanceDue: contracted - paid,
        profit: paid - costs,
        notes: (p.notes || "").trim(),
        openRequests: openReqs.map((r) => r.text),
        doneRequests: (p.requests || []).filter((r) => r.done).map((r) => r.text),
      };
    });

  const dueSoon = entries
    .filter((e) => e.balanceDue > 0)
    .sort((a, b) => b.balanceDue - a.balanceDue);

  const active = entries.filter((e) =>
    ["proposed", "in_progress", "review", "delivered"].includes(e.status)
  );

  return {
    owner: userName || OWNER.name,
    atelier: OWNER.atelier,
    currency,
    projectCount: list.length,
    totals,
    byStatus,
    dueSoon,
    active,
    entries,
  };
}

function snapshotText(snap) {
  const lines = [
    `صاحب السجل: ${snap.owner} — ${snap.atelier}`,
    `العملة: ${snap.currency}`,
    `عدد المشاريع: ${snap.projectCount}`,
    `المتعاقد: ${money(snap.totals.contracted, snap.currency)}`,
    `المستلم: ${money(snap.totals.paid, snap.currency)}`,
    `التكاليف: ${money(snap.totals.costs, snap.currency)}`,
    `المستحق: ${money(snap.totals.outstanding, snap.currency)}`,
    `صافي الربح: ${money(snap.totals.profit, snap.currency)}`,
    `الحالات: ${Object.entries(snap.byStatus)
      .map(([k, v]) => `${STATUS_AR[k] || k}=${v}`)
      .join(" | ") || "لا يوجد"}`,
    "",
    "المشاريع (من الأحدث):",
  ];

  if (!snap.entries.length) {
    lines.push("- لا توجد إدخالات بعد.");
  } else {
    for (const e of snap.entries) {
      lines.push(
        [
          `${e.index}. «${e.name}» | عميل: ${e.client}${e.phone ? ` | هاتف: ${e.phone}` : ""}`,
          `   الحالة: ${e.statusAr} | عقد: ${money(e.contracted, snap.currency)} | مستلم: ${money(e.paid, snap.currency)} | تكاليف: ${money(e.costs, snap.currency)}`,
          `   مستحق: ${money(e.balanceDue, snap.currency)} | ربح: ${money(e.profit, snap.currency)}`,
          e.notes ? `   ملاحظات: ${e.notes}` : null,
          e.openRequests.length
            ? `   طلبات مفتوحة: ${e.openRequests.join("؛ ")}`
            : "   طلبات مفتوحة: لا يوجد",
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
  }

  if (snap.dueSoon.length) {
    lines.push("", "أعلى المستحقات:");
    snap.dueSoon.slice(0, 5).forEach((e) => {
      lines.push(`- ${e.name} (${e.client}): ${money(e.balanceDue, snap.currency)}`);
    });
  }

  return lines.join("\n");
}

function systemPrompt(snap) {
  return `أنت «مستشار Mohammad» — المساعد الشخصي الحصري لـ ${snap.owner}.
تعمل محليًا بالكامل (Ollama / Qwen3) بدون إنترنت.
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
    throw new Error("تعذّر الاتصال بـ Ollama المحلي على هذا الجهاز. شغّل Ollama ثم أعد المحاولة.");
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

export async function getDailyBriefing(projects, currency, userName = OWNER.name) {
  const snap = buildLedgerSnapshot(projects, currency, userName);
  try {
    return await callLocal(
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

export async function analyzeBusinessPerformance(projects, currency, userName = OWNER.name) {
  const snap = buildLedgerSnapshot(projects, currency, userName);
  try {
    return await callLocal(
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

export async function getProjectRecommendations(project, currency, allProjects = [], userName = OWNER.name) {
  const snap = buildLedgerSnapshot(allProjects.length ? allProjects : [project], currency, userName);
  const balance = (Number(project.totalPrice) || 0) - (Number(project.paid) || 0);
  const profit = (Number(project.paid) || 0) - (Number(project.costs) || 0);
  const openReqs = (project.requests || []).filter((r) => !r.done);

  try {
    return await callLocal(
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
المستلم: ${money(project.paid, currency)}
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

export async function chatWithAI(projects, currency, userName, userMessage, history = [], selectedProject = null) {
  const snap = buildLedgerSnapshot(projects, currency, userName);
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
    return await callLocal(messages, { temperature: 0.4, maxTokens: 1200 });
  } catch (error) {
    return `خطأ: ${error.message}`;
  }
}

export async function draftWhatsAppFollowUp(project, currency, userName = OWNER.name) {
  const snap = buildLedgerSnapshot([project], currency, userName);
  const balance = (Number(project.totalPrice) || 0) - (Number(project.paid) || 0);
  try {
    return await callLocal(
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

export { OWNER, DEFAULT_MODEL };
