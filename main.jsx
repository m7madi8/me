import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Plus, Trash2, X, Check, ChevronRight, Brain, LogOut } from "lucide-react";
import { ensureLocalAI, OWNER } from "./ai-service.js";
import AIAdvisorPage from "./ai-panel.jsx";
import LoginScreen from "./login.jsx";
import {
  isFirebaseConfigured,
  watchAuth,
  logout,
  loadCloudLedger,
  saveCloudLedger,
  mergeLedger,
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
  bg: "#070707",
  page: "#111111",
  pageRaised: "#1A1A1A",
  hover: "#161616",
  rule: "#2A2A2A",
  ruleFaint: "#1C1C1C",
  text: "#F0F0EE",
  textMuted: "#9B9B97",
  textFaint: "#5E5E5A",
  white: "#F0F0EE",
  accent: "#E8E8E4",
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
  requests: [],
  createdAt: Date.now(),
});
const fmt = (n) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const folio = (n) => String(n).padStart(3, "0");

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
  const [view, setView] = useState("ledger"); // ledger | ai
  const [projects, setProjects] = useState([]);
  const [currency, setCurrency] = useState("$");
  const [selectedId, setSelectedId] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newRequestText, setNewRequestText] = useState("");
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
          } catch (_) {
            setSyncLabel("محلي فقط");
          }
        }

        const data = mergeLedger(localData, cloudData);
        setProjects(data.projects || []);
        setCurrency(data.currency || "$");
        setUserName(data.userName || OWNER.name);

        // If local was newer, push once to cloud
        if (user && localData && (!cloudData || (localData.updatedAt || 0) > (cloudData.updatedAt || 0))) {
          try {
            await saveCloudLedger(user.uid, {
              projects: localData.projects || [],
              currency: localData.currency || "$",
              userName: localData.userName || OWNER.name,
              updatedAt: localData.updatedAt || Date.now(),
            });
          } catch (_) {}
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
        setSyncLabel("فشل المزامنة");
      }
    })();
  }, [projects, currency, loaded, userName, user]);

  async function handleLogout() {
    await logout();
    setProjects([]);
    setSelectedId(null);
    setView("ledger");
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

  const totalContracted = projects.reduce((s, p) => s + (Number(p.totalPrice) || 0), 0);
  const totalPaid = projects.reduce((s, p) => s + (Number(p.paid) || 0), 0);
  const totalOutstanding = totalContracted - totalPaid;
  const totalCosts = projects.reduce((s, p) => s + (Number(p.costs) || 0), 0);
  const totalProfit = totalPaid - totalCosts;

  const showIndex = !isMobile || !selectedId;
  const showRecord = !isMobile || !!selectedId;

  if (!authReady) {
    return (
      <Shell>
        <div className="app-frame flex items-center justify-center" style={{ minHeight: "100vh" }}>
          <p className="fade-in" style={{ fontFamily: "var(--font-body)", color: INK.textFaint, fontSize: 14, fontStyle: "italic" }}>
            Opening Mohammad…
          </p>
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
        <div className="app-frame flex items-center justify-center" style={{ minHeight: "100vh" }}>
          <p className="fade-in" style={{ fontFamily: "var(--font-body)", color: INK.textFaint, fontSize: 14, fontStyle: "italic" }}>
            جارٍ مزامنة سجلك…
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="app-frame fade-in">
        <header className="header">
          <div className="brand">
            <Seal />
            <div>
              <h1 className="brand-title">{view === "ai" ? "مستشار Mohammad" : "Mohammad"}</h1>
              <p className="brand-sub">
                {user ? user.email : "سجل أعمال"}
                {syncLabel && <span className="ai-pill">{syncLabel}</span>}
              </p>
            </div>
          </div>

          <div className="header-actions">
            {saveError && <span className="save-error">Save failed</span>}

            <nav className="view-switch" aria-label="التنقل">
              <button
                type="button"
                className={`view-btn ${view === "ledger" ? "is-active" : ""}`}
                onClick={() => setView("ledger")}
              >
                السجل
              </button>
              <button
                type="button"
                className={`view-btn ${view === "ai" ? "is-active" : ""}`}
                onClick={() => setView("ai")}
              >
                <Brain size={14} />
                مستشار
              </button>
            </nav>

            {user && (
              <IconBtn title="تسجيل الخروج" onClick={handleLogout}>
                <LogOut size={16} />
              </IconBtn>
            )}

            {view === "ledger" && (
              <>
                <select
                  className="currency-select"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  aria-label="Currency"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <button className="btn-primary" onClick={() => setShowNewForm(true)}>
                  <Plus size={16} strokeWidth={2.2} />
                  <span>New</span>
                </button>
              </>
            )}
          </div>
        </header>

        {view === "ai" ? (
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
        ) : (
          <>
            <section className="totals" aria-label="Ledger totals">
              <TotalCell label="Contracted" value={`${fmt(totalContracted)} ${currency}`} />
              <TotalCell label="Received" value={`${fmt(totalPaid)} ${currency}`} bright />
              <TotalCell label="Outstanding" value={`${fmt(totalOutstanding)} ${currency}`} bright={totalOutstanding > 0} />
              <TotalCell label="Net Profit" value={`${fmt(totalProfit)} ${currency}`} bright last />
            </section>

            <div className="spread">
              <aside className={`index-pane ${showIndex ? "is-visible" : "is-hidden"}`}>
                <div className="pane-label">
                  Index
                  <span className="pane-count">{projects.length}</span>
                </div>

                <div className="index-list mh-scroll">
                  {projects.length === 0 ? (
                    <div className="empty-state">
                      <p>No entries yet.</p>
                      <button className="btn-ghost" onClick={() => setShowNewForm(true)}>
                        Open a new entry
                      </button>
                    </div>
                  ) : (
                    byCreation
                      .slice()
                      .reverse()
                      .map((p) => {
                        const s = STATUS[p.status];
                        const balance = (Number(p.totalPrice) || 0) - (Number(p.paid) || 0);
                        const active = selectedId === p.id;
                        const link = waLink(p.phone, p.name, p.client);
                        return (
                          <div key={p.id} className={`index-row ${active ? "is-active" : ""}`}>
                            <button className="index-main" onClick={() => setSelectedId(p.id)}>
                              <div className="index-top">
                                <span className="folio">No.{folio(folioOf(p.id))}</span>
                                <span className="index-name">{p.name || "Untitled"}</span>
                              </div>
                              <div className="index-client">{p.client || "No client"}</div>
                              <div className="index-meta">
                                <Stamp status={s} small />
                                {balance > 0 && (
                                  <span className="due">{fmt(balance)} {currency} due</span>
                                )}
                              </div>
                            </button>
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
                              <button className="chev" onClick={() => setSelectedId(p.id)} aria-label="Open">
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
                    <Seal large />
                    <p>Select an entry from the index</p>
                    <span>or open a new one to begin</span>
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
                    newRequestText={newRequestText}
                    setNewRequestText={setNewRequestText}
                  />
                )}
              </main>
            </div>
          </>
        )}
      </div>

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

function Seal({ large }) {
  const size = large ? 56 : 40;
  return (
    <div
      className="seal"
      style={{ width: size, height: size, fontSize: large ? 18 : 14 }}
      aria-hidden
    >
      M
    </div>
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
  onAddRequest, onToggleRequest, onDeleteRequest, newRequestText, setNewRequestText,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const balance = (Number(project.totalPrice) || 0) - (Number(project.paid) || 0);
  const profit = (Number(project.paid) || 0) - (Number(project.costs) || 0);
  const openCount = project.requests.filter((r) => !r.done).length;
  const link = waLink(project.phone, project.name, project.client);

  return (
    <div className="record fade-in">
      <div className="record-toolbar">
        {isMobile ? (
          <button className="back-btn" onClick={onBack}>
            <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
            Index
          </button>
        ) : (
          <span className="entry-ref">Entry No.{folioNumber}</span>
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
            <MoneyInput value={project.paid} onChange={(v) => onChange({ paid: v })} currency={currency} />
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

      <Field label="Notes">
        <textarea
          className="field-input notes"
          value={project.notes}
          placeholder="Anything worth remembering…"
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </Field>

      <section className="amendments">
        <div className="pane-label">
          Client requests
          {openCount > 0 && <span className="pane-count">{openCount} open</span>}
        </div>

        <div className="request-compose">
          <input
            className="field-input"
            placeholder="What did the client ask for?"
            value={newRequestText}
            onChange={(e) => setNewRequestText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAddRequest(newRequestText)}
          />
          <button className="btn-primary" onClick={() => onAddRequest(newRequestText)}>Add</button>
        </div>

        <div className="request-list">
          {project.requests.length === 0 && (
            <p className="muted-italic">Nothing on file.</p>
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
  const [status, setStatus] = useState("proposed");

  function submit() {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), client: client.trim(), phone: phone.trim(), totalPrice: totalPrice || 0, status });
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
          <button className="btn-primary btn-block" onClick={submit}>Open entry</button>
        </div>
      </div>
    </div>
  );
}

const CSS = `
  :root {
    --font-display: Georgia, "Times New Roman", Times, serif;
    --font-body: Georgia, "Times New Roman", Times, serif;
    --font-mono: Consolas, "Courier New", monospace;
  }

  *, *::before, *::after { box-sizing: border-box; }
  button, input, select, textarea { font: inherit; color: inherit; }
  button { cursor: pointer; background: none; border: none; padding: 0; }
  a { color: ${INK.text}; }
  input:focus, select:focus, textarea:focus { outline: none; }

  .shell {
    min-height: 100vh;
    background:
      radial-gradient(ellipse 80% 50% at 50% -10%, #1a1a1a 0%, transparent 55%),
      ${INK.bg};
    color: ${INK.text};
  }

  .app-frame {
    max-width: 1100px;
    margin: 0 auto;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    border-inline: 1px solid ${INK.ruleFaint};
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
    gap: 16px;
    padding: 20px 22px 18px;
    border-bottom: 1px solid ${INK.rule};
  }
  .brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .brand-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  .brand-sub {
    margin: 3px 0 0;
    font-family: var(--font-body);
    font-style: italic;
    font-size: 12px;
    color: ${INK.textFaint};
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .ai-pill {
    font-family: var(--font-mono);
    font-style: normal;
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: none;
    color: ${INK.text};
    border: 1px solid ${INK.rule};
    border-radius: 999px;
    padding: 2px 8px;
    background: ${INK.bg};
  }
  .seal {
    flex-shrink: 0;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #151515;
    border: 1px solid ${INK.rule};
    box-shadow: inset 0 0 0 3px ${INK.bg}, inset 0 0 0 4px ${INK.rule};
    font-family: var(--font-display);
    font-style: italic;
    font-weight: 600;
    color: ${INK.text};
  }

  .login-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
  }
  .login-card {
    width: 100%;
    max-width: 420px;
    background: ${INK.page};
    border: 1px solid ${INK.rule};
    border-radius: 14px;
    padding: 28px 22px;
    text-align: center;
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
    box-shadow: inset 0 0 0 3px ${INK.bg}, inset 0 0 0 4px ${INK.rule};
    font-family: var(--font-display);
    font-style: italic;
    font-weight: 600;
    font-size: 18px;
  }
  .login-card h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 28px;
    font-weight: 600;
  }
  .login-sub {
    margin: 10px 0 22px;
    font-family: var(--font-body);
    font-size: 13.5px;
    line-height: 1.6;
    color: ${INK.textMuted};
  }
  .login-steps {
    text-align: left;
    direction: ltr;
    margin: 0;
    padding: 12px;
    border-radius: 8px;
    background: ${INK.bg};
    border: 1px solid ${INK.rule};
    font-family: var(--font-mono);
    font-size: 11px;
    color: ${INK.textMuted};
    overflow-x: auto;
  }
  .login-links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    margin-top: 16px;
  }
  .login-card .form-stack { text-align: right; }
  .btn-google {
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px 16px;
    border-radius: 8px;
    background: ${INK.white};
    color: #1a1a1a;
    font-family: var(--font-body);
    font-size: 15px;
    font-weight: 600;
    transition: opacity 0.15s ease;
  }
  .btn-google:hover { opacity: 0.92; }
  .btn-google:disabled { opacity: 0.6; cursor: default; }
  .login-hint {
    margin: 16px 0 0;
    font-family: var(--font-body);
    font-size: 12px;
    line-height: 1.5;
    color: ${INK.textFaint};
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .view-switch {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border: 1px solid ${INK.rule};
    border-radius: 10px;
    background: ${INK.bg};
  }
  .view-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-radius: 7px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    color: ${INK.textFaint};
    transition: background 0.15s ease, color 0.15s ease;
  }
  .view-btn:hover { color: ${INK.textMuted}; }
  .view-btn.is-active {
    background: ${INK.pageRaised};
    color: ${INK.text};
  }

  /* Dedicated AI page */
  .ai-page {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: ${INK.page};
  }
  .ai-hero {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 18px;
    padding: 22px 22px 16px;
    border-bottom: 1px solid ${INK.ruleFaint};
  }
  .ai-kicker {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    color: ${INK.textFaint};
    margin-bottom: 8px;
  }
  .ai-title {
    margin: 0;
    font-family: var(--font-display);
    font-style: italic;
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .ai-sub {
    margin: 8px 0 0;
    max-width: 420px;
    font-family: var(--font-body);
    font-size: 13.5px;
    line-height: 1.55;
    color: ${INK.textMuted};
  }
  .ai-stats {
    display: flex;
    gap: 18px;
  }
  .ai-stats > div {
    min-width: 72px;
    padding: 12px 14px;
    border: 1px solid ${INK.rule};
    border-radius: 8px;
    background: ${INK.bg};
  }
  .ai-stats span {
    display: block;
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: ${INK.textFaint};
  }
  .ai-stats strong {
    display: block;
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: 16px;
  }
  .ai-tabs {
    display: flex;
    gap: 4px;
    padding: 12px 16px;
    overflow-x: auto;
    border-bottom: 1px solid ${INK.rule};
  }
  .ai-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    padding: 9px 12px;
    border-radius: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: ${INK.textFaint};
  }
  .ai-tab.is-active {
    background: ${INK.pageRaised};
    color: ${INK.text};
    border: 1px solid ${INK.rule};
  }
  .ai-error {
    margin: 12px 22px 0;
    padding: 10px 12px;
    border: 1px solid ${INK.rule};
    border-radius: 8px;
    background: ${INK.bg};
    font-family: var(--font-body);
    font-size: 13px;
    color: ${INK.text};
    white-space: pre-wrap;
  }
  .ai-error.is-ok {
    border-color: #3a3a38;
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
    padding: 18px 22px 24px;
  }
  .ai-panel-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }
  .ai-panel-toolbar h3 {
    margin: 0;
    font-family: var(--font-display);
    font-style: italic;
    font-size: 18px;
    font-weight: 600;
  }
  .ai-panel-toolbar .btn-ghost,
  .ai-panel-toolbar .btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .ai-prose, .ai-body {
    margin: 0;
    white-space: pre-wrap;
    font-family: var(--font-body);
    font-size: 14px;
    line-height: 1.8;
    color: ${INK.text};
  }
  .chat-panel { padding-bottom: 0; }
  .ai-panel-scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 280px;
    max-height: calc(100vh - 340px);
    padding-bottom: 12px;
  }
  .sticky-compose {
    position: sticky;
    bottom: 0;
    padding: 12px 0 18px;
    background: linear-gradient(180deg, transparent, ${INK.page} 28%);
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

  .save-error {
    font-family: var(--font-mono);
    font-size: 10px;
    color: ${INK.text};
    letter-spacing: 0.04em;
  }
  .currency-select {
    width: 64px;
    padding: 9px 8px;
    background: ${INK.bg};
    border: 1px solid ${INK.rule};
    border-radius: 6px;
    font-family: var(--font-mono);
    font-size: 12px;
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
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    border-radius: 6px;
    transition: opacity 0.15s ease, transform 0.15s ease;
  }
  .btn-primary:hover { opacity: 0.92; }
  .btn-primary:active { transform: scale(0.98); }
  .btn-block { width: 100%; padding: 12px; }
  .btn-ghost {
    font-family: var(--font-mono);
    font-size: 11px;
    color: ${INK.textMuted};
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid ${INK.rule};
    transition: color 0.15s ease, border-color 0.15s ease;
  }
  .btn-ghost:hover { color: ${INK.text}; border-color: ${INK.textMuted}; }
  .btn-danger {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 8px 12px;
    border-radius: 6px;
    background: ${INK.white};
    color: #0A0A0A;
    font-weight: 700;
  }

  /* Totals */
  .totals {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0;
    padding: 4px 0;
    border-bottom: 1px solid ${INK.rule};
  }
  @media (min-width: 700px) {
    .totals { grid-template-columns: repeat(4, 1fr); }
  }
  .total-cell {
    padding: 16px 22px;
    border-inline-end: 1px solid ${INK.ruleFaint};
  }
  .total-cell.is-last { border-inline-end: none; }
  @media (max-width: 699px) {
    .total-cell:nth-child(2n) { border-inline-end: none; }
    .total-cell:nth-child(-n+2) { border-bottom: 1px solid ${INK.ruleFaint}; }
  }
  .total-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${INK.textFaint};
  }
  .total-value {
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: 17px;
    font-weight: 700;
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
    border-inline-end: 1px solid ${INK.rule};
    background: ${INK.bg};
    min-height: 420px;
  }
  .pane-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 10px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: ${INK.textFaint};
  }
  .pane-count {
    color: ${INK.textMuted};
    letter-spacing: 0;
    text-transform: none;
  }
  .index-list {
    max-height: none;
    overflow-y: auto;
  }
  @media (min-width: 1024px) {
    .index-list { max-height: calc(100vh - 220px); }
  }

  .index-row {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid ${INK.ruleFaint};
    border-inline-start: 2px solid transparent;
    transition: background 0.15s ease;
  }
  .index-row:hover { background: ${INK.hover}; }
  .index-row.is-active {
    background: ${INK.pageRaised};
    border-inline-start-color: ${INK.white};
  }
  .index-main {
    flex: 1;
    text-align: left;
    padding: 14px 16px 14px 18px;
    min-width: 0;
  }
  .index-top { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .folio {
    font-family: var(--font-mono);
    font-size: 10px;
    color: ${INK.textFaint};
    flex-shrink: 0;
  }
  .index-name {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 15px;
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
  .chev { border: none; color: ${INK.textFaint}; margin-inline-end: 6px; }

  .empty-state {
    padding: 28px 20px;
    text-align: center;
  }
  .empty-state p {
    margin: 0 0 14px;
    font-family: var(--font-body);
    font-style: italic;
    font-size: 13px;
    color: ${INK.textFaint};
  }

  .record-pane { background: ${INK.page}; min-height: 520px; }
  .empty-record {
    min-height: 520px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: ${INK.textFaint};
    text-align: center;
    padding: 40px 20px;
  }
  .empty-record p {
    margin: 12px 0 0;
    font-family: var(--font-body);
    font-style: italic;
    font-size: 14px;
    color: ${INK.textMuted};
  }
  .empty-record span {
    font-family: var(--font-body);
    font-size: 12px;
  }

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
