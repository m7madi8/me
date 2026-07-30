import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Plus, Trash2, X, Check, ChevronRight, LogOut, ExternalLink } from "lucide-react";
import { ensureLocalAI, OWNER } from "./ai-service.js";
import AIAdvisorPage from "./ai-panel.jsx";
import LoginScreen from "./login.jsx";
import logoMe from "./img/logo-me.webp";
import {
  isFirebaseConfigured,
  watchAuth,
  logout,
  loadCloudLedger,
  saveCloudLedger,
  mergeLedger,
  syncErrorMessage,
} from "./auth.js";

if (!window.storage) {
  window.storage = {
    async get(key) {
      const value = localStorage.getItem(key);
      return value == null ? null : { value };
    },
    async set(key, value) {
      localStorage.setItem(key, value);
      return true;
    },
  };
}

const LOCAL_KEY = "mh-tracker-data";

/* =========================================================
   Mohammad — synced ledger + local Qwen3 advisor
========================================================= */

const INK = {
  bg: "#212121",
  page: "#212121",
  pageRaised: "#2f2f2f",
  hover: "#2a2a2a",
  rule: "#3a3a3a",
  ruleFaint: "#2f2f2f",
  text: "#ececec",
  textMuted: "#b4b4b4",
  textFaint: "#8e8e8e",
  white: "#ffffff",
  accent: "#ececec",
  sidebar: "#171717",
  composer: "#303030",
};

const STATUS = {
  proposed: { label: "Proposed", fg: "#9B9B97", bg: "transparent", border: "#3A3A38", dashed: true },
  in_progress: { label: "In Progress", fg: "#F0F0EE", bg: "transparent", border: "#F0F0EE", dashed: true },
  review: { label: "In Review", fg: "#070707", bg: "#B8B8B3", border: "#B8B8B3", dashed: false },
  delivered: { label: "Delivered", fg: "#070707", bg: "#E8E8E4", border: "#E8E8E4", dashed: false },
  settled: { label: "Settled", fg: "#6A6A66", bg: "transparent", border: "#2A2A2A", dashed: false },
};
const STATUS_ORDER = ["proposed", "in_progress", "review", "delivered", "settled"];
const CURRENCIES = ["$", "\u20AA", "JOD"];

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const emptyProject = () => ({
  id: uid(),
  name: "",
  client: "",
  phone: "",
  status: "proposed",
  totalPrice: 0,
  paid: 0,
  costs: 0,
  notes: "",
  demoUrl: "",
  requests: [],
  payments: [],
  createdAt: Date.now(),
});
const fmt = (n) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const folio = (n) => String(n).padStart(3, "0");

function normalizeUrl(url) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u}`;
}

function demoHref(project) {
  const href = normalizeUrl(project?.demoUrl);
  return href || null;
}

/** Sum of payment entries; falls back to legacy `paid` if none yet. */
function projectPaid(p) {
  const payments = Array.isArray(p?.payments) ? p.payments : [];
  if (payments.length > 0) {
    return payments.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  }
  return Number(p?.paid) || 0;
}

function fmtPayDate(ts) {
  try {
    return new Date(ts || Date.now()).toLocaleDateString("ar-EG", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch (_) {
    return "";
  }
}

function syncPaid(payments) {
  return (payments || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
}

function waLink(phone, name, client) {
  const digits = (phone || "").replace(/[^\d]/g, "");
  if (!digits) return null;
  const msg = encodeURIComponent(
    `Hi${client ? " " + client : ""}, this is mohammad — following up on ${name || "our project"}.`
  );
  return `https://wa.me/${digits}?text=${msg}`;
}

function WhatsAppIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.46-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51-.17-.01-.37-.01-.57-.01-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35z" />
      <path d="M12 2C6.48 2 2 6.48 2 12c0 1.89.53 3.66 1.44 5.17L2 22l4.93-1.4A9.95 9.95 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18a7.94 7.94 0 0 1-4.06-1.12l-.29-.17-3.02.85.87-2.94-.19-.3A7.94 7.94 0 0 1 4 12c0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8-8 8z" />
    </svg>
  );
}

export default function MHLedger() {
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured());
  const [user, setUser] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [projects, setProjects] = useState([]);
  const [currency, setCurrency] = useState("$");
  const [selectedId, setSelectedId] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newRequestText, setNewRequestText] = useState("");
  const [newPayAmount, setNewPayAmount] = useState("");
  const [newPayNote, setNewPayNote] = useState("");
  const [saveError, setSaveError] = useState(false);
  const [syncLabel, setSyncLabel] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const firstLoad = useRef(true);
  const [userName, setUserName] = useState(OWNER.name);
  const [aiReady, setAiReady] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener ? mq.addEventListener("change", apply) : mq.addListener(apply);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", apply) : mq.removeListener(apply));
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setAuthReady(true);
      setUser(null);
      return;
    }
    return watchAuth((u) => {
      setUser(u);
      setAuthReady(true);
      if (!u) {
        setLoaded(false);
        firstLoad.current = true;
      }
    });
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (isFirebaseConfigured() && !user) {
      setLoaded(false);
      return;
    }

    (async () => {
      setLoaded(false);
      try {
        const status = await ensureLocalAI();
        setAiReady(!!status.ok);

        let localData = null;
        const res = await window.storage.get(LOCAL_KEY);
        if (res && res.value) localData = JSON.parse(res.value);

        let cloudData = null;
        if (user) {
          try {
            cloudData = await loadCloudLedger(user.uid);
            setSyncLabel("متزامن");
            setSaveError(false);
          } catch (err) {
            setSyncLabel(syncErrorMessage(err));
            setSaveError(true);
          }
        } else if (!isFirebaseConfigured()) {
          setSyncLabel("بدون حساب");
        }

        const data = mergeLedger(localData, cloudData);
        setProjects(data.projects || []);
        setCurrency(data.currency || "$");
        setUserName(data.userName || OWNER.name);

        // Push local to cloud when this device has newer/richer data
        if (user && data === localData && localData) {
          try {
            await saveCloudLedger(user.uid, {
              projects: localData.projects || [],
              currency: localData.currency || "$",
              userName: localData.userName || OWNER.name,
              updatedAt: localData.updatedAt || Date.now(),
            });
            setSyncLabel("متزامن");
            setSaveError(false);
          } catch (err) {
            setSyncLabel(syncErrorMessage(err));
            setSaveError(true);
          }
        }
      } catch (e) {}
      firstLoad.current = true;
      setLoaded(true);
    })();
  }, [authReady, user]);

  useEffect(() => {
    if (!loaded) return;
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    (async () => {
      const payload = { projects, currency, userName, updatedAt: Date.now() };
      try {
        await window.storage.set(LOCAL_KEY, JSON.stringify(payload));
        if (user) {
          await saveCloudLedger(user.uid, payload);
          setSyncLabel("متزامن");
        }
        setSaveError(false);
      } catch (e) {
        setSaveError(true);
        if (user) setSyncLabel(syncErrorMessage(e));
        else setSyncLabel("فشل الحفظ");
      }
    })();
  }, [projects, currency, loaded, userName, user]);

  async function handleLogout() {
    await logout();
    setProjects([]);
    setSelectedId(null);
    setAiOpen(false);
  }

  const selected = projects.find((p) => p.id === selectedId) || null;
  const byCreation = [...projects].sort((a, b) => a.createdAt - b.createdAt);
  const folioOf = (id) => byCreation.findIndex((p) => p.id === id) + 1;

  function updateProject(id, patch) {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function addProject(data) {
    const p = { ...emptyProject(), ...data };
    setProjects((prev) => [p, ...prev]);
    setSelectedId(p.id);
    setShowNewForm(false);
  }
  function deleteProject(id) {
    const remaining = projects.filter((p) => p.id !== id);
    setProjects(remaining);
    if (selectedId === id) setSelectedId(null);
  }
  function addRequest(text) {
    if (!selected || !text.trim()) return;
    const req = { id: uid(), text: text.trim(), done: false };
    updateProject(selected.id, { requests: [req, ...selected.requests] });
    setNewRequestText("");
  }
  function toggleRequest(reqId) {
    updateProject(selected.id, {
      requests: selected.requests.map((r) => (r.id === reqId ? { ...r, done: !r.done } : r)),
    });
  }
  function deleteRequest(reqId) {
    updateProject(selected.id, { requests: selected.requests.filter((r) => r.id !== reqId) });
  }
  function addPayment(amount, note) {
    if (!selected) return;
    const n = Number(amount);
    if (!n || n <= 0) return;
    const list = Array.isArray(selected.payments) ? selected.payments : [];
    let payments = list;
    // Migrate legacy single paid total into first recorded payment
    if (payments.length === 0 && Number(selected.paid) > 0) {
      payments = [
        {
          id: uid(),
          amount: Number(selected.paid),
          note: "رصيد سابق",
          at: selected.createdAt || Date.now(),
        },
      ];
    }
    const pay = {
      id: uid(),
      amount: n,
      note: (note || "").trim(),
      at: Date.now(),
    };
    payments = [pay, ...payments];
    updateProject(selected.id, { payments, paid: syncPaid(payments) });
    setNewPayAmount("");
    setNewPayNote("");
  }
  function deletePayment(payId) {
    if (!selected) return;
    const payments = (selected.payments || []).filter((p) => p.id !== payId);
    updateProject(selected.id, { payments, paid: syncPaid(payments) });
  }

  const totalContracted = projects.reduce((s, p) => s + (Number(p.totalPrice) || 0), 0);
  const totalPaid = projects.reduce((s, p) => s + projectPaid(p), 0);
  const totalOutstanding = totalContracted - totalPaid;
  const totalCosts = projects.reduce((s, p) => s + (Number(p.costs) || 0), 0);
  const totalProfit = totalPaid - totalCosts;

  const showIndex = !isMobile || !selectedId;
  const showRecord = !isMobile || !!selectedId;

  if (!authReady) {
    return (
      <Shell>
        <div className="boot-screen fade-in">
          <img src={logoMe} alt="Mohammad" className="boot-logo" />
        </div>
      </Shell>
    );
  }

  if (isFirebaseConfigured() && !user) {
    return (
      <Shell>
        <LoginScreen />
      </Shell>
    );
  }

  if (!loaded) {
    return (
      <Shell>
        <div className="boot-screen fade-in">
          <img src={logoMe} alt="Mohammad" className="boot-logo" />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="app-frame fade-in">
        <header className="header">
          <div className="brand">
            <Logo height={34} />
            <div className="brand-meta">
              {user ? (
                <>
                  <div className="brand-email" title={user.email}>{user.email}</div>
                  <div className={`brand-sync ${saveError ? "is-bad" : ""}`}>
                    {syncLabel || "جاري المزامنة…"}
                  </div>
                </>
              ) : (
                <div className="brand-sync">{syncLabel || "محلي"}</div>
              )}
            </div>
          </div>

          <div className="header-actions">
            {user && (
              <IconBtn title="تسجيل الخروج" onClick={handleLogout}>
                <LogOut size={16} />
              </IconBtn>
            )}

            <select
              className="currency-select"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              aria-label="العملة"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button className="btn-primary" onClick={() => setShowNewForm(true)}>
              <Plus size={16} strokeWidth={2.2} />
            </button>
          </div>
        </header>

        <section className="totals soft" aria-label="ملخص">
          <TotalCell label="متعاقد" value={`${fmt(totalContracted)} ${currency}`} />
          <TotalCell label="مستلم" value={`${fmt(totalPaid)} ${currency}`} bright />
          <TotalCell label="متبقي" value={`${fmt(totalOutstanding)} ${currency}`} bright={totalOutstanding > 0} />
          <TotalCell label="صافي" value={`${fmt(totalProfit)} ${currency}`} bright last />
        </section>

        <div className="spread">
          <aside className={`index-pane ${showIndex ? "is-visible" : "is-hidden"}`}>
            <div className="index-list mh-scroll">
              {projects.length === 0 ? (
                <div className="empty-state">
                  <p>لا مشاريع بعد</p>
                  <button className="btn-ghost" onClick={() => setShowNewForm(true)}>
                    أضف مشروع
                  </button>
                </div>
              ) : (
                byCreation
                  .slice()
                  .reverse()
                  .map((p) => {
                    const s = STATUS[p.status];
                    const balance = (Number(p.totalPrice) || 0) - projectPaid(p);
                    const active = selectedId === p.id;
                    const link = waLink(p.phone, p.name, p.client);
                    const demo = demoHref(p);
                    return (
                      <div key={p.id} className={`index-row ${active ? "is-active" : ""}`}>
                        <button className="index-main" onClick={() => setSelectedId(p.id)}>
                          <div className="index-top">
                            <span className="index-name">{p.name || "بدون عنوان"}</span>
                          </div>
                          <div className="index-client">{p.client || "—"}</div>
                          <div className="index-meta">
                            <Stamp status={s} small />
                            {balance > 0 && (
                              <span className="due">{fmt(balance)} {currency}</span>
                            )}
                          </div>
                        </button>
                        {demo && (
                          <a
                            href={demo}
                            target="_blank"
                            rel="noreferrer"
                            className="demo-chip"
                            onClick={(e) => e.stopPropagation()}
                            title="Demo"
                          >
                            <ExternalLink size={13} />
                            Demo
                          </a>
                        )}
                        {link && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            className="wa-chip"
                            onClick={(e) => e.stopPropagation()}
                            title="WhatsApp"
                          >
                            <WhatsAppIcon size={14} />
                          </a>
                        )}
                        {isMobile && (
                          <button className="chev" onClick={() => setSelectedId(p.id)} aria-label="فتح">
                            <ChevronRight size={16} />
                          </button>
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          </aside>

          <main className={`record-pane ${showRecord ? "is-visible" : "is-hidden"}`}>
            {!selected ? (
              <div className="empty-record">
                <Logo height={48} />
                <p>اختر مشروعاً من القائمة</p>
              </div>
            ) : (
              <RecordPage
                project={selected}
                folioNumber={folio(folioOf(selected.id))}
                currency={currency}
                isMobile={isMobile}
                onBack={() => setSelectedId(null)}
                onChange={(patch) => updateProject(selected.id, patch)}
                onDelete={() => deleteProject(selected.id)}
                onAddRequest={addRequest}
                onToggleRequest={toggleRequest}
                onDeleteRequest={deleteRequest}
                onAddPayment={addPayment}
                onDeletePayment={deletePayment}
                newRequestText={newRequestText}
                setNewRequestText={setNewRequestText}
                newPayAmount={newPayAmount}
                setNewPayAmount={setNewPayAmount}
                newPayNote={newPayNote}
                setNewPayNote={setNewPayNote}
              />
            )}
          </main>
        </div>
      </div>

      {!aiOpen && !showNewForm && (
        <button
          type="button"
          className={`ai-fab ${aiReady ? "is-ready" : ""}`}
          onClick={() => setAiOpen(true)}
          title="المساعد"
          aria-label="فتح المساعد"
        >
          <img src={logoMe} alt="" className="fab-logo" />
        </button>
      )}

      {aiOpen && (
        <div className="ai-drawer-backdrop" onClick={() => setAiOpen(false)}>
          <aside className="ai-drawer gpt slide-side" onClick={(e) => e.stopPropagation()} dir="rtl">
            <div className="ai-drawer-head quiet">
              <Logo height={26} />
              <button type="button" className="icon-btn drawer-close" onClick={() => setAiOpen(false)} aria-label="إغلاق">
                <X size={18} />
              </button>
            </div>
            <div className="ai-drawer-body">
              <AIAdvisorPage
                projects={projects}
                currency={currency}
                userName={userName}
                setUserName={setUserName}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                aiReady={aiReady}
                setAiReady={setAiReady}
              />
            </div>
          </aside>
        </div>
      )}

      {showNewForm && <NewEntryModal onClose={() => setShowNewForm(false)} onCreate={addProject} currency={currency} />}
    </Shell>
  );
}

/* ---------- shared ---------- */

function Shell({ children }) {
  return (
    <div className="shell">
      <style>{CSS}</style>
      {children}
    </div>
  );
}

function IconBtn({ children, onClick, title }) {
  return (
    <button className="icon-btn" onClick={onClick} title={title} type="button">
      {children}
    </button>
  );
}

function Logo({ height = 32 }) {
  return (
    <img
      src={logoMe}
      alt="Mohammad"
      className="brand-logo"
      style={{ height, width: "auto" }}
      draggable={false}
    />
  );
}

function TotalCell({ label, value, bright, last }) {
  return (
    <div className={`total-cell ${last ? "is-last" : ""}`}>
      <div className="total-label">{label}</div>
      <div className={`total-value ${bright ? "is-bright" : ""}`}>{value}</div>
    </div>
  );
}

function Stamp({ status: s, small }) {
  return (
    <span
      className={`stamp ${small ? "is-small" : ""} ${s.dashed ? "is-dashed" : ""}`}
      style={{ color: s.fg, background: s.bg, borderColor: s.border }}
    >
      {s.label}
    </span>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

/* ---------- record ---------- */

function RecordPage({
  project, folioNumber, currency, isMobile, onBack, onChange, onDelete,
  onAddRequest, onToggleRequest, onDeleteRequest, onAddPayment, onDeletePayment,
  newRequestText, setNewRequestText, newPayAmount, setNewPayAmount, newPayNote, setNewPayNote,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const paid = projectPaid(project);
  const balance = (Number(project.totalPrice) || 0) - paid;
  const profit = paid - (Number(project.costs) || 0);
  const openCount = project.requests.filter((r) => !r.done).length;
  const link = waLink(project.phone, project.name, project.client);
  const demo = demoHref(project);
  const payments = Array.isArray(project.payments) ? project.payments : [];
  const displayPayments =
    payments.length > 0
      ? payments
      : Number(project.paid) > 0
        ? [{ id: "_legacy", amount: Number(project.paid), note: "رصيد مسجّل", at: project.createdAt, legacy: true }]
        : [];

  return (
    <div className="record fade-in">
      <div className="record-toolbar">
        {isMobile ? (
          <button className="back-btn" onClick={onBack}>
            <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
            رجوع
          </button>
        ) : (
          <span className="entry-ref">#{folioNumber}</span>
        )}

        <div className="record-toolbar-actions">
          {demo && (
            <a href={demo} target="_blank" rel="noreferrer" className="demo-chip is-lg">
              <ExternalLink size={14} />
              Demo
            </a>
          )}
          {confirmDelete ? (
            <div className="confirm-row">
              <button className="btn-danger" onClick={onDelete}>Delete</button>
              <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          ) : (
            <IconBtn title="Delete" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={16} />
            </IconBtn>
          )}
        </div>
      </div>

      <section className="record-identity">
        <input
          className="title-input"
          value={project.name}
          placeholder="Project title"
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <input
          className="client-input"
          value={project.client}
          placeholder="Client name"
          onChange={(e) => onChange({ client: e.target.value })}
        />
        <div className="phone-row">
          <input
            className="field-input mono"
            value={project.phone}
            placeholder="+970 59 123 4567"
            onChange={(e) => onChange({ phone: e.target.value })}
          />
          <a
            href={link || undefined}
            target={link ? "_blank" : undefined}
            rel="noreferrer"
            onClick={(e) => !link && e.preventDefault()}
            className={`wa-btn ${link ? "is-ready" : ""}`}
          >
            <WhatsAppIcon size={14} />
            <span>WhatsApp</span>
          </a>
        </div>
        <Field label="رابط المشروع (اختياري)">
          <input
            className="field-input mono"
            value={project.demoUrl || ""}
            placeholder="https://demo.example.com"
            onChange={(e) => onChange({ demoUrl: e.target.value })}
            onBlur={(e) => onChange({ demoUrl: normalizeUrl(e.target.value) })}
          />
        </Field>
      </section>

      <Field label="Status">
        <div className="status-row">
          {STATUS_ORDER.map((key) => {
            const s = STATUS[key];
            const active = project.status === key;
            return (
              <button key={key} type="button" onClick={() => onChange({ status: key })} className="status-pick">
                {active ? (
                  <Stamp status={s} />
                ) : (
                  <span className="stamp is-idle">{s.label}</span>
                )}
              </button>
            );
          })}
        </div>
      </Field>

      <div className="figures">
        <div className="figures-inputs">
          <LedgerCell label="Contracted">
            <MoneyInput value={project.totalPrice} onChange={(v) => onChange({ totalPrice: v })} currency={currency} />
          </LedgerCell>
          <LedgerCell label="Received">
            <div className="money is-readonly">
              <span>{currency}</span>
              <strong>{fmt(paid)}</strong>
            </div>
          </LedgerCell>
          <LedgerCell label="Costs" last>
            <MoneyInput value={project.costs} onChange={(v) => onChange({ costs: v })} currency={currency} />
          </LedgerCell>
        </div>
        <div className="figures-summary">
          <div className="summary-cell">
            <div className="total-label">Balance due</div>
            <div className={`total-value ${balance > 0 ? "is-bright" : ""}`}>{fmt(balance)} {currency}</div>
          </div>
          <div className="summary-cell is-last">
            <div className="total-label">Net profit</div>
            <div className="total-value is-bright">{fmt(profit)} {currency}</div>
          </div>
        </div>
      </div>

      <section className="amendments payments-block" dir="rtl">
        <div className="section-title">
          الدفعات
          {displayPayments.length > 0 && (
            <span className="section-count">{displayPayments.length}</span>
          )}
        </div>

        <div className="pay-compose">
          <input
            type="number"
            inputMode="decimal"
            className="field-input"
            placeholder={`المبلغ (${currency})`}
            value={newPayAmount}
            onChange={(e) => setNewPayAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAddPayment(newPayAmount, newPayNote)}
          />
          <input
            className="field-input"
            placeholder="ملاحظة (اختياري)"
            value={newPayNote}
            onChange={(e) => setNewPayNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAddPayment(newPayAmount, newPayNote)}
          />
          <button className="btn-primary" type="button" onClick={() => onAddPayment(newPayAmount, newPayNote)}>
            إضافة
          </button>
        </div>

        <div className="pay-list">
          {displayPayments.length === 0 && (
            <p className="muted-italic">لا دفعات بعد — سجّل أول دفعة أعلاه.</p>
          )}
          {displayPayments.map((pay) => (
            <div key={pay.id} className="pay-row">
              <div className="pay-main">
                <strong className="pay-amount">{fmt(pay.amount)} {currency}</strong>
                <span className="pay-meta">
                  {fmtPayDate(pay.at)}
                  {pay.note ? ` · ${pay.note}` : ""}
                </span>
              </div>
              {!pay.legacy && (
                <button type="button" className="icon-btn" onClick={() => onDeletePayment(pay.id)} aria-label="حذف دفعة">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <Field label="Notes">
        <textarea
          className="field-input notes"
          value={project.notes}
          placeholder="Anything worth remembering…"
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </Field>

      <section className="amendments">
        <div className="section-title">
          طلبات العميل
          {openCount > 0 && <span className="section-count">{openCount}</span>}
        </div>

        <div className="request-compose">
          <input
            className="field-input"
            placeholder="ماذا طلب العميل؟"
            value={newRequestText}
            onChange={(e) => setNewRequestText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAddRequest(newRequestText)}
          />
          <button className="btn-primary" onClick={() => onAddRequest(newRequestText)}>إضافة</button>
        </div>

        <div className="request-list">
          {project.requests.length === 0 && (
            <p className="muted-italic">لا طلبات.</p>
          )}
          {project.requests.map((r, i) => (
            <div key={r.id} className="request-row">
              <span className="req-num">{String(i + 1).padStart(2, "0")}</span>
              <button
                type="button"
                className={`check ${r.done ? "is-done" : ""}`}
                onClick={() => onToggleRequest(r.id)}
                aria-label={r.done ? "Mark open" : "Mark done"}
              >
                {r.done && <Check size={12} color={INK.bg} />}
              </button>
              <span className={`req-text ${r.done ? "is-done" : ""}`}>{r.text}</span>
              <button type="button" className="icon-btn" onClick={() => onDeleteRequest(r.id)} aria-label="Remove">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function LedgerCell({ label, children, last }) {
  return (
    <div className={`ledger-cell ${last ? "is-last" : ""}`}>
      <div className="total-label">{label}</div>
      {children}
    </div>
  );
}

function MoneyInput({ value, onChange, currency }) {
  return (
    <div className="money">
      <span>{currency}</span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function NewEntryModal({ onClose, onCreate, currency }) {
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [phone, setPhone] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [demoUrl, setDemoUrl] = useState("");
  const [status, setStatus] = useState("proposed");

  function submit() {
    if (!name.trim()) return;
    onCreate({
      name: name.trim(),
      client: client.trim(),
      phone: phone.trim(),
      totalPrice: totalPrice || 0,
      demoUrl: normalizeUrl(demoUrl),
      status,
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal slide-up" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2 className="modal-heading">New entry</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="form-stack">
          <Field label="Project">
            <input autoFocus className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Darna Booking System" />
          </Field>
          <Field label="Client">
            <input className="field-input" value={client} onChange={(e) => setClient(e.target.value)} placeholder="e.g. Nadine" />
          </Field>
          <Field label="Phone">
            <input className="field-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+970591234567" />
          </Field>
          <Field label={`Amount (${currency})`}>
            <input type="number" inputMode="decimal" className="field-input" value={totalPrice} onChange={(e) => setTotalPrice(e.target.value)} />
          </Field>
          <Field label="Status">
            <select className="field-input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_ORDER.map((k) => (
                <option key={k} value={k}>{STATUS[k].label}</option>
              ))}
            </select>
          </Field>
          <Field label="رابط المشروع (اختياري)">
            <input
              className="field-input"
              value={demoUrl}
              onChange={(e) => setDemoUrl(e.target.value)}
              placeholder="https://demo.example.com"
            />
          </Field>
          <button className="btn-primary btn-block" onClick={submit}>Open entry</button>
        </div>
      </div>
    </div>
  );
}

const CSS = `
  :root {
    --font-display: "Segoe UI", system-ui, -apple-system, sans-serif;
    --font-body: "Segoe UI", system-ui, -apple-system, sans-serif;
    --font-mono: ui-monospace, Consolas, monospace;
  }

  *, *::before, *::after { box-sizing: border-box; }
  button, input, select, textarea { font: inherit; color: inherit; }
  button { cursor: pointer; background: none; border: none; padding: 0; }
  a { color: ${INK.text}; }
  input:focus, select:focus, textarea:focus { outline: none; }
  textarea { resize: none; }

  .shell {
    min-height: 100vh;
    background: ${INK.bg};
    color: ${INK.text};
  }

  .boot-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .boot-logo {
    height: 56px;
    width: auto;
    max-width: 160px;
    object-fit: contain;
    display: block;
  }

  .app-frame {
    max-width: 1100px;
    margin: 0 auto;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: ${INK.page};
  }

  .fade-in { animation: fadeIn 0.35s ease both; }
  .slide-up { animation: slideUp 0.28s ease both; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { animation: spin 1.6s linear infinite; }

  /* Header */
  .header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 18px;
    border-bottom: 1px solid ${INK.ruleFaint};
    background: ${INK.sidebar};
  }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .brand-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .brand-email {
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: min(42vw, 240px);
  }
  .brand-sync {
    font-size: 11px;
    color: ${INK.textFaint};
  }
  .brand-sync.is-bad { color: #e8a0a0; }
  .brand-logo {
    flex-shrink: 0;
    width: auto;
    object-fit: contain;
    display: block;
  }
  .brand-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  .brand-sub {
    margin: 3px 0 0;
    font-family: var(--font-body);
    font-size: 12px;
    color: ${INK.textFaint};
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .ai-pill {
    font-family: var(--font-body);
    font-size: 11px;
    color: ${INK.textMuted};
    border: 1px solid ${INK.rule};
    border-radius: 999px;
    padding: 3px 10px;
    background: ${INK.pageRaised};
  }
  .seal {
    flex-shrink: 0;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #151515;
    border: 1px solid ${INK.rule};
    font-family: var(--font-display);
    font-weight: 600;
    color: ${INK.text};
  }

  .login-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    background: ${INK.bg};
  }
  .login-shell {
    width: min(420px, 100%);
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .login-hero {
    text-align: center;
  }
  .login-hero h1, .login-card h1, .login-card h2 {
    margin: 0 0 8px;
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 600;
  }
  .login-card {
    width: min(380px, 100%);
    padding: 36px 28px 28px;
    border-radius: 16px;
    background: ${INK.sidebar};
    border: 1px solid ${INK.ruleFaint};
    text-align: center;
  }
  .login-card.gpt {
    box-shadow: 0 16px 48px rgba(0,0,0,0.28);
  }
  .login-logo {
    height: 64px;
    width: auto;
    max-width: 200px;
    object-fit: contain;
    margin: 0 auto 18px;
    display: block;
  }
  .login-one-line {
    margin: 0 0 22px;
    font-size: 15px;
    color: ${INK.textMuted};
  }
  .login-seal {
    width: 52px;
    height: 52px;
    margin: 0 auto 14px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #151515;
    border: 1px solid ${INK.rule};
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 18px;
  }
  .login-seal.lg { width: 64px; height: 64px; font-size: 22px; }
  .login-sub {
    margin: 0 0 20px;
    font-family: var(--font-body);
    font-size: 13.5px;
    line-height: 1.6;
    color: ${INK.textMuted};
  }
  .login-bullets {
    list-style: none;
    margin: 18px 0 0;
    padding: 0;
    text-align: right;
    font-family: var(--font-body);
    font-size: 12.5px;
    color: ${INK.textFaint};
    line-height: 1.8;
  }
  .login-bullets li::before { content: "· "; color: ${INK.textMuted}; }
  .btn-google {
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px 16px;
    border-radius: 999px;
    background: ${INK.white};
    color: #1a1a1a;
    font-family: var(--font-body);
    font-size: 15px;
    font-weight: 600;
  }
  .btn-google:disabled { opacity: 0.6; cursor: default; }

  .ai-fab {
    position: fixed;
    z-index: 60;
    inset-inline-end: 18px;
    bottom: 22px;
    width: 56px;
    height: 56px;
    border-radius: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #0a0a0a;
    color: ${INK.text};
    border: 1px solid ${INK.rule};
    box-shadow: 0 8px 28px rgba(0,0,0,0.35);
    padding: 8px;
  }
  .fab-logo {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .ai-fab.is-ready { box-shadow: 0 8px 28px rgba(0,0,0,0.35), 0 0 0 2px #4a4a4a; }
  .ai-drawer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 55;
    background: rgba(0,0,0,0.45);
    display: flex;
    justify-content: flex-start;
  }
  .ai-drawer {
    width: min(440px, 100%);
    height: 100%;
    background: ${INK.bg};
    border-inline-end: 1px solid ${INK.ruleFaint};
    display: flex;
    flex-direction: column;
    box-shadow: 12px 0 40px rgba(0,0,0,0.4);
  }
  .ai-drawer.gpt { width: min(520px, 100%); }
  .ai-drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 10px 12px 14px;
    border-bottom: 1px solid ${INK.ruleFaint};
    background: ${INK.sidebar};
  }
  .ai-drawer-head.quiet { min-height: 52px; }
  .drawer-close {
    margin-inline-start: auto;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    color: ${INK.textMuted};
  }
  .drawer-close:hover {
    background: ${INK.pageRaised};
    color: ${INK.text};
  }
  .ai-drawer-head strong {
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 600;
  }
  .ai-drawer-body { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
  .slide-side { animation: slideSide 0.28s ease both; }
  @keyframes slideSide {
    from { opacity: 0; transform: translateX(18px); }
    to { opacity: 1; transform: translateX(0); }
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  /* Dedicated AI page — ChatGPT style */
  .ai-page {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: ${INK.bg};
  }
  .ai-page.gpt-chat {
    flex-direction: row;
  }
  .ai-rail {
    width: 52px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px 0;
    border-inline-end: 1px solid ${INK.ruleFaint};
    background: ${INK.sidebar};
  }
  .ai-rail-btn {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: ${INK.textFaint};
  }
  .ai-rail-btn:hover { background: ${INK.hover}; color: ${INK.text}; }
  .ai-rail-btn.is-active {
    background: ${INK.pageRaised};
    color: ${INK.text};
  }
  .ai-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-top: auto;
    margin-bottom: 10px;
    background: #555;
  }
  .ai-dot.on { background: #6fcf97; }

  .ai-hero { display: none; }
  .ai-kicker, .ai-title, .ai-sub, .ai-stats { display: none; }
  .ai-tabs { display: none; }

  .ai-error {
    margin: 10px 14px 0;
    padding: 10px 12px;
    border: 1px solid ${INK.rule};
    border-radius: 12px;
    background: ${INK.sidebar};
    font-family: var(--font-body);
    font-size: 13px;
    color: ${INK.text};
    white-space: pre-wrap;
  }
  .ai-error.soft { border-radius: 12px; }
  .ai-error.is-ok {
    border-color: ${INK.rule};
    color: ${INK.textMuted};
  }
  .ai-body-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .ai-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 12px 16px 16px;
  }
  .ai-panel.soft-panel { padding: 16px; }
  .ai-panel-toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    margin-bottom: 12px;
  }
  .ai-panel-toolbar.quiet { margin-bottom: 8px; }
  .ai-panel-toolbar h3 { display: none; }
  .ai-prose, .ai-body {
    margin: 0;
    white-space: pre-wrap;
    font-family: var(--font-body);
    font-size: 14.5px;
    line-height: 1.7;
    color: ${INK.text};
  }
  .chat-panel.gpt { padding: 0; }
  .ai-panel-scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding: 8px 16px 12px;
  }
  .chat-empty.gpt {
    min-height: min(52vh, 420px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 10px;
    padding: 24px 12px;
  }
  .chat-empty-logo {
    height: 52px;
    width: auto;
    max-width: 160px;
    object-fit: contain;
    margin-bottom: 6px;
    display: block;
  }
  .chat-empty.gpt h2 {
    margin: 0 0 8px;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .chat-hint { display: none; }
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    max-width: 420px;
  }
  .chip.soft, .chip {
    padding: 10px 14px;
    border-radius: 999px;
    background: ${INK.pageRaised};
    border: 1px solid ${INK.rule};
    color: ${INK.textMuted};
    font-size: 13px;
    line-height: 1.35;
    text-align: right;
  }
  .chip.soft:hover, .chip:hover {
    background: ${INK.hover};
    color: ${INK.text};
  }
  .chat-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin: 14px 0;
    max-width: 100%;
  }
  .chat-row.is-user {
    justify-content: flex-start;
    flex-direction: row-reverse;
  }
  .chat-avatar {
    width: 36px;
    height: 22px;
    object-fit: contain;
    flex-shrink: 0;
    margin-top: 4px;
    display: block;
  }
  .chat-bubble.gpt {
    max-width: min(92%, 420px);
    padding: 10px 14px;
    border-radius: 18px;
    background: transparent;
  }
  .chat-bubble.gpt.is-user {
    background: ${INK.pageRaised};
  }
  .chat-bubble.gpt.is-ai {
    padding-inline-start: 0;
  }
  .chat-role { display: none; }
  .chat-text {
    font-size: 15px;
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .typing-dots {
    display: inline-flex;
    gap: 5px;
    padding: 12px 4px;
  }
  .typing-dots span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${INK.textFaint};
    animation: blink 1.2s infinite ease-in-out;
  }
  .typing-dots span:nth-child(2) { animation-delay: 0.15s; }
  .typing-dots span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes blink {
    0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
    40% { opacity: 1; transform: translateY(-2px); }
  }

  .sticky-compose {
    position: sticky;
    bottom: 0;
    padding: 10px 14px 16px;
    background: linear-gradient(180deg, transparent, ${INK.bg} 28%);
  }
  .composer {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 24px;
    background: ${INK.composer};
    border: 1px solid ${INK.rule};
  }
  .composer-input {
    flex: 1;
    min-height: 24px;
    max-height: 140px;
    border: none;
    background: transparent;
    font-size: 15px;
    line-height: 1.45;
    padding: 4px 6px;
  }
  .composer-send {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: ${INK.white};
    color: #111;
    flex-shrink: 0;
  }
  .composer-send:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .loading-line {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 28px 0;
    font-family: var(--font-body);
    color: ${INK.textFaint};
  }

  .save-error {
    font-family: var(--font-body);
    font-size: 12px;
    color: ${INK.textMuted};
  }
  .currency-select {
    width: 64px;
    padding: 9px 8px;
    background: ${INK.pageRaised};
    border: 1px solid ${INK.rule};
    border-radius: 10px;
    color: ${INK.text};
  }

  .tool-group {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: 1px solid ${INK.rule};
    border-radius: 8px;
    background: ${INK.bg};
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 6px;
    color: ${INK.textMuted};
    transition: background 0.15s ease, color 0.15s ease;
  }
  .icon-btn:hover { background: ${INK.pageRaised}; color: ${INK.text}; }

  .btn-primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 14px;
    background: ${INK.white};
    color: #0A0A0A;
    font-family: var(--font-body);
    font-size: 13px;
    font-weight: 600;
    border-radius: 10px;
    transition: opacity 0.15s ease, transform 0.15s ease;
  }
  .btn-primary:hover { opacity: 0.92; }
  .btn-primary:active { transform: scale(0.98); }
  .btn-block { width: 100%; padding: 12px; }
  .btn-ghost {
    font-family: var(--font-body);
    font-size: 13px;
    color: ${INK.textMuted};
    padding: 8px 12px;
    border-radius: 10px;
    border: 1px solid ${INK.rule};
    transition: color 0.15s ease, border-color 0.15s ease;
  }
  .btn-ghost:hover { color: ${INK.text}; border-color: ${INK.textMuted}; }
  .btn-danger {
    font-family: var(--font-body);
    font-size: 13px;
    padding: 8px 12px;
    border-radius: 10px;
    background: ${INK.white};
    color: #0A0A0A;
    font-weight: 600;
  }

  /* Totals */
  .totals {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0;
    padding: 2px 0;
    border-bottom: 1px solid ${INK.ruleFaint};
    background: ${INK.sidebar};
  }
  .totals.soft .total-label {
    font-family: var(--font-body);
    font-size: 11px;
    letter-spacing: 0;
    text-transform: none;
  }
  .totals.soft .total-value {
    font-family: var(--font-body);
    font-size: 16px;
    font-weight: 600;
  }
  @media (min-width: 700px) {
    .totals { grid-template-columns: repeat(4, 1fr); }
  }
  .total-cell {
    padding: 14px 18px;
    border-inline-end: 1px solid ${INK.ruleFaint};
  }
  .total-cell.is-last { border-inline-end: none; }
  @media (max-width: 699px) {
    .total-cell:nth-child(2n) { border-inline-end: none; }
    .total-cell:nth-child(-n+2) { border-bottom: 1px solid ${INK.ruleFaint}; }
  }
  .total-label {
    font-family: var(--font-body);
    font-size: 11px;
    color: ${INK.textFaint};
  }
  .total-value {
    margin-top: 4px;
    font-family: var(--font-body);
    font-size: 16px;
    font-weight: 600;
    color: ${INK.textMuted};
    letter-spacing: -0.02em;
  }
  .total-value.is-bright { color: ${INK.white}; }

  /* Personal briefing */
  .briefing {
    padding: 14px 22px 16px;
    border-bottom: 1px solid ${INK.rule};
    background: linear-gradient(180deg, #141414 0%, ${INK.page} 100%);
  }
  .briefing-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }
  .briefing-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    color: ${INK.textMuted};
  }
  .briefing-refresh {
    padding: 6px 10px;
    font-size: 10px;
  }
  .briefing-body {
    margin: 0;
    white-space: pre-wrap;
    font-family: var(--font-body);
    font-size: 13.5px;
    line-height: 1.7;
    color: ${INK.text};
  }
  .ai-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .ai-actions .btn-ghost {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    margin-top: 12px;
  }
  .chip {
    font-family: var(--font-body);
    font-size: 12.5px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid ${INK.rule};
    background: ${INK.bg};
    color: ${INK.textMuted};
    transition: border-color 0.15s ease, color 0.15s ease;
  }
  .chip:hover:not(:disabled) {
    border-color: ${INK.textMuted};
    color: ${INK.text};
  }
  .chip:disabled { opacity: 0.5; cursor: default; }
  .chat-empty { padding: 8px 0 4px; }

  /* Spread */
  .spread {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr;
    min-height: 0;
  }
  @media (min-width: 1024px) {
    .spread { grid-template-columns: 300px 1fr; }
  }
  .is-hidden { display: none !important; }
  .is-visible { display: block; }
  @media (min-width: 1024px) {
    .index-pane, .record-pane { display: block !important; }
  }

  .index-pane {
    border-inline-end: 1px solid ${INK.ruleFaint};
    background: ${INK.sidebar};
    min-height: 420px;
  }
  .pane-label { display: none; }
  .pane-count { display: none; }
  .index-list {
    max-height: none;
    overflow-y: auto;
    padding: 8px 0;
  }
  @media (min-width: 1024px) {
    .index-list { max-height: calc(100vh - 180px); }
  }

  .index-row {
    display: flex;
    align-items: stretch;
    margin: 2px 8px;
    border-radius: 12px;
    border-bottom: none;
    border-inline-start: none;
    transition: background 0.15s ease;
  }
  .index-row:hover { background: ${INK.hover}; }
  .index-row.is-active {
    background: ${INK.pageRaised};
  }
  .index-main {
    flex: 1;
    text-align: left;
    padding: 14px 16px 14px 18px;
    min-width: 0;
  }
  .index-top { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .folio { display: none; }
  .index-name {
    font-family: var(--font-body);
    font-size: 14.5px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .index-client {
    margin-top: 4px;
    font-family: var(--font-body);
    font-size: 12px;
    color: ${INK.textFaint};
  }
  .index-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 10px;
  }
  .due {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: ${INK.text};
  }
  .wa-chip, .chev {
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    width: 34px;
    height: 34px;
    margin-inline-end: 10px;
    border-radius: 50%;
    border: 1px solid ${INK.rule};
    color: ${INK.textMuted};
    flex-shrink: 0;
    transition: border-color 0.15s ease, color 0.15s ease;
  }
  .wa-chip:hover { border-color: ${INK.text}; color: ${INK.text}; }
  .demo-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    gap: 5px;
    height: 34px;
    padding: 0 12px;
    margin-inline-end: 8px;
    border-radius: 999px;
    border: 1px solid ${INK.rule};
    background: ${INK.pageRaised};
    color: ${INK.text};
    font-size: 12px;
    font-weight: 600;
    flex-shrink: 0;
    text-decoration: none;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  .demo-chip:hover {
    border-color: ${INK.textMuted};
    background: ${INK.hover};
  }
  .demo-chip.is-lg {
    height: 36px;
    padding: 0 14px;
    margin: 0;
    font-size: 13px;
  }
  .record-toolbar-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .chev { border: none; color: ${INK.textFaint}; margin-inline-end: 6px; }

  .empty-state {
    padding: 28px 20px;
    text-align: center;
  }
  .empty-state p {
    margin: 0 0 14px;
    font-family: var(--font-body);
    font-size: 14px;
    color: ${INK.textFaint};
  }

  .record-pane { background: ${INK.page}; min-height: 520px; }
  .empty-record {
    min-height: 520px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    color: ${INK.textFaint};
    text-align: center;
    padding: 40px 20px;
  }
  .empty-record p {
    margin: 0;
    font-family: var(--font-body);
    font-size: 15px;
    color: ${INK.textMuted};
  }
  .empty-record span { display: none; }

  /* Record */
  .record {
    padding: 22px 22px 36px;
    display: flex;
    flex-direction: column;
    gap: 22px;
    max-width: 720px;
  }
  .record-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .entry-ref, .back-btn {
    font-family: var(--font-mono);
    font-size: 11px;
    color: ${INK.textFaint};
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .back-btn:hover { color: ${INK.text}; }
  .confirm-row { display: flex; align-items: center; gap: 8px; }

  .record-identity {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-bottom: 18px;
    border-bottom: 1px solid ${INK.rule};
  }
  .title-input {
    width: 100%;
    background: transparent;
    border: none;
    font-family: var(--font-display);
    font-style: italic;
    font-weight: 600;
    font-size: 26px;
    letter-spacing: -0.02em;
    padding: 0;
    color: ${INK.text};
  }
  .title-input::placeholder { color: ${INK.textFaint}; }
  .client-input {
    width: 100%;
    background: transparent;
    border: none;
    font-family: var(--font-body);
    font-size: 14px;
    padding: 0;
    color: ${INK.textMuted};
  }
  .client-input::placeholder { color: ${INK.textFaint}; }
  .phone-row { display: flex; gap: 8px; margin-top: 4px; }

  .field { display: flex; flex-direction: column; gap: 8px; }
  .field-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${INK.textFaint};
  }
  .field-input {
    width: 100%;
    background: ${INK.bg};
    border: 1px solid ${INK.rule};
    border-radius: 6px;
    padding: 11px 12px;
    font-family: var(--font-body);
    font-size: 14px;
    color: ${INK.text};
    transition: border-color 0.15s ease;
  }
  .field-input:focus { border-color: ${INK.textMuted}; }
  .field-input::placeholder { color: ${INK.textFaint}; }
  .field-input.mono { font-family: var(--font-mono); font-size: 13px; }
  .field-input.notes {
    min-height: 72px;
    resize: vertical;
    font-style: italic;
    line-height: 1.5;
  }
  .field-hint {
    margin: 6px 0 0;
    font-family: var(--font-body);
    font-size: 12px;
    color: ${INK.textFaint};
  }

  .status-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .status-pick { line-height: 0; }
  .stamp {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border: 1px solid;
    border-radius: 4px 10px 4px 10px;
    padding: 5px 11px;
  }
  .stamp.is-small { font-size: 9.5px; padding: 3px 8px; }
  .stamp.is-dashed { border-style: dashed; }
  .stamp.is-idle {
    color: ${INK.textFaint};
    border-color: ${INK.rule};
    background: transparent;
  }
  .stamp.is-idle:hover { border-color: ${INK.textMuted}; color: ${INK.textMuted}; }

  .figures {
    border: 1px solid ${INK.rule};
    border-radius: 8px;
    overflow: hidden;
    background: ${INK.bg};
  }
  .figures-inputs {
    display: grid;
    grid-template-columns: 1fr;
  }
  @media (min-width: 560px) {
    .figures-inputs { grid-template-columns: repeat(3, 1fr); }
  }
  .ledger-cell {
    padding: 14px 16px;
    border-bottom: 1px solid ${INK.ruleFaint};
  }
  @media (min-width: 560px) {
    .ledger-cell {
      border-bottom: none;
      border-inline-end: 1px solid ${INK.ruleFaint};
    }
    .ledger-cell.is-last { border-inline-end: none; }
  }
  .figures-summary {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-top: 1px solid ${INK.rule};
  }
  .summary-cell {
    padding: 14px 16px;
    border-inline-end: 1px solid ${INK.ruleFaint};
  }
  .summary-cell.is-last { border-inline-end: none; }

  .money {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  }
  .money span {
    font-family: var(--font-mono);
    font-size: 13px;
    color: ${INK.textFaint};
  }
  .money input {
    width: 100%;
    background: transparent;
    border: none;
    font-family: var(--font-mono);
    font-size: 16px;
    font-weight: 700;
    color: ${INK.text};
    padding: 0;
  }

  .wa-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    height: 42px;
    padding: 0 14px;
    border-radius: 6px;
    border: 1px solid ${INK.rule};
    color: ${INK.textFaint};
    font-family: var(--font-mono);
    font-size: 11px;
    text-decoration: none;
    opacity: 0.65;
  }
  .wa-btn.is-ready {
    border-color: ${INK.textMuted};
    color: ${INK.text};
    opacity: 1;
  }
  .wa-btn.is-ready:hover { border-color: ${INK.text}; }

  .amendments { display: flex; flex-direction: column; gap: 12px; }
  .section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 14px;
    font-weight: 600;
    color: ${INK.text};
  }
  .section-count {
    font-size: 12px;
    font-weight: 500;
    color: ${INK.textFaint};
    background: ${INK.pageRaised};
    border-radius: 999px;
    padding: 2px 8px;
  }
  .pay-compose {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }
  @media (min-width: 560px) {
    .pay-compose {
      grid-template-columns: 120px 1fr auto;
      align-items: center;
    }
  }
  .pay-list { display: flex; flex-direction: column; }
  .pay-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 0;
    border-bottom: 1px solid ${INK.ruleFaint};
  }
  .pay-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .pay-amount {
    font-size: 15px;
    font-weight: 600;
  }
  .pay-meta {
    font-size: 12px;
    color: ${INK.textFaint};
  }
  .money.is-readonly {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 8px 0 2px;
    color: ${INK.text};
  }
  .money.is-readonly strong {
    font-size: 18px;
    font-weight: 600;
  }
  .request-compose { display: flex; gap: 8px; }
  .request-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid ${INK.ruleFaint};
  }
  .req-num {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: ${INK.textFaint};
    width: 18px;
  }
  .check {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1.5px solid ${INK.textFaint};
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .check.is-done {
    background: ${INK.text};
    border-color: ${INK.text};
  }
  .req-text {
    flex: 1;
    font-family: var(--font-body);
    font-size: 14px;
  }
  .req-text.is-done {
    color: ${INK.textFaint};
    text-decoration: line-through;
  }
  .muted-italic {
    margin: 0;
    font-family: var(--font-body);
    font-style: italic;
    font-size: 13px;
    color: ${INK.textFaint};
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 0;
    background: rgba(0,0,0,0.72);
    backdrop-filter: blur(4px);
  }
  @media (min-width: 640px) {
    .modal-backdrop {
      align-items: center;
      padding: 16px;
    }
  }
  .modal {
    width: 100%;
    max-width: 460px;
    max-height: 92vh;
    overflow-y: auto;
    background: ${INK.page};
    border: 1px solid ${INK.rule};
    border-radius: 12px 12px 0 0;
    padding: 22px;
    color: ${INK.text};
  }
  @media (min-width: 640px) {
    .modal { border-radius: 12px; }
  }
  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 20px;
  }
  .modal-title {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .modal-title h2, .modal-heading {
    margin: 0;
    font-family: var(--font-display);
    font-style: italic;
    font-size: 18px;
    font-weight: 600;
  }
  .form-stack { display: flex; flex-direction: column; gap: 16px; }
  .mode-seg {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: 12px;
    background: ${INK.sidebar};
    border: 1px solid ${INK.ruleFaint};
  }
  .mode-seg-btn {
    flex: 1;
    padding: 10px 8px;
    border-radius: 9px;
    font-size: 13px;
    color: ${INK.textFaint};
  }
  .mode-seg-btn.is-active {
    background: ${INK.pageRaised};
    color: ${INK.text};
    font-weight: 600;
  }
  .field-hint {
    font-size: 12.5px;
    line-height: 1.5;
    color: ${INK.textFaint};
  }

  .ai-body {
    font-family: var(--font-body);
    font-size: 14px;
    line-height: 1.8;
    white-space: pre-wrap;
  }
  .loading-line {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 28px 0;
    font-family: var(--font-body);
    font-style: italic;
    color: ${INK.textFaint};
  }
  .chat-log {
    max-height: 380px;
    overflow-y: auto;
    margin-bottom: 14px;
  }
  .chat-hint {
    text-align: center;
    padding: 28px 12px;
    font-family: var(--font-body);
    font-style: italic;
    color: ${INK.textFaint};
    margin: 0;
  }
  .chat-bubble {
    padding: 12px 14px;
    margin-bottom: 8px;
    border-radius: 10px;
  }
  .chat-bubble.is-user {
    background: ${INK.pageRaised};
    border: 1px solid ${INK.rule};
  }
  .chat-role {
    font-family: var(--font-mono);
    font-size: 10px;
    color: ${INK.textFaint};
    margin-bottom: 4px;
  }
  .chat-text {
    font-family: var(--font-body);
    font-size: 14px;
    white-space: pre-wrap;
    line-height: 1.6;
  }
  .chat-compose { display: flex; gap: 8px; }

  .mh-scroll::-webkit-scrollbar { width: 6px; }
  .mh-scroll::-webkit-scrollbar-thumb { background: #2B2B2B; border-radius: 4px; }
  input[type=number]::-webkit-inner-spin-button { opacity: 0.35; }

  @media (max-width: 480px) {
    .header { padding: 16px; }
    .record { padding: 16px 16px 28px; }
    .brand-title { font-size: 20px; }
    .btn-primary span { display: none; }
    .wa-btn span { display: none; }
    .wa-btn { padding: 0 12px; }
  }
`;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MHLedger />
  </React.StrictMode>
);
