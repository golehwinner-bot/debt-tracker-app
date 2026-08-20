import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, X, Check, TrendingDown, Copy, ChevronDown, ChevronUp, Percent, Banknote, Pencil } from "lucide-react";

const STORAGE_KEY = "debts-v1";

const uid = () => Math.random().toString(36).slice(2, 10);

const fmt = (n) =>
  new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(Math.round(n));

const todayISO = () => new Date().toISOString().slice(0, 10);

const emptyState = {
  debts: [
    { id: uid(), name: "Карта Сенс", original: 23500, balance: 23500, rate: 3.8, minPayment: 2000 },
    { id: uid(), name: "Карта Приват", original: 49000, balance: 49000, rate: 3.5, minPayment: 2000 },
    { id: uid(), name: "Карта Моно", original: 52000, balance: 52000, rate: 3.1, minPayment: 2000 },
  ],
  payments: [],
};

// Backward-compat: entries without `type` are treated as payments
const entryType = (p) => p.type || "payment";

export default function DebtTracker() {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [addingDebt, setAddingDebt] = useState(false);
  const [actionFor, setActionFor] = useState(null); // { debtId, mode: 'payment' | 'interest' }
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [newDebt, setNewDebt] = useState({ name: "", balance: "", rate: "", minPayment: "" });
  const [expanded, setExpanded] = useState(null);
  const [showExport, setShowExport] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [syncState, setSyncState] = useState("connecting"); // connecting | synced | offline
  const [copyState, setCopyState] = useState("idle");

  useEffect(() => {
    (async () => {
      // Локальний кеш для миттєвого відображення, поки йде запит до сервера
      let cached = null;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        cached = raw ? JSON.parse(raw) : null;
        if (cached) setData(cached);
      } catch (e) {
        // ignore
      }

      try {
        const res = await fetch("/api/data");
        if (!res.ok) throw new Error("network");
        const json = await res.json();
        const remote = json && json.data;
        setData(remote || cached || emptyState);
        setSyncState("synced");
      } catch (e) {
        setData(cached || emptyState);
        setSyncState("offline");
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const persist = useCallback(async (next) => {
    setSaveState("saving");
    // Локальний кеш пишемо одразу — не залежить від мережі
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      // ignore
    }
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error("network");
      setSyncState("synced");
      setSaveState("saved");
    } catch (e) {
      setSyncState("offline");
      setSaveState("saved");
    }
    setTimeout(() => setSaveState("idle"), 900);
  }, []);

  const update = (next) => {
    setData(next);
    persist(next);
  };

  if (!loaded || !data) {
    return (
      <div style={{ background: "#14202B", minHeight: 400 }} className="flex items-center justify-center rounded-xl">
        <div className="text-sm tracking-wide" style={{ color: "#8A9BA8" }}>Завантаження…</div>
      </div>
    );
  }

  const totalOriginal = data.debts.reduce((s, d) => s + d.original, 0);
  const totalBalance = data.debts.reduce((s, d) => s + d.balance, 0);
  const totalPaid = data.payments.filter((p) => entryType(p) === "payment").reduce((s, p) => s + p.amount, 0);
  const totalInterest = data.payments.filter((p) => entryType(p) === "interest").reduce((s, p) => s + p.amount, 0);
  const netReduction = totalOriginal - totalBalance;
  const progressPct = totalOriginal > 0 ? Math.max(0, Math.min(100, (netReduction / totalOriginal) * 100)) : 0;
  const activeDebts = data.debts.filter((d) => d.balance > 0.5);
  const sortedByRate = [...activeDebts].sort((a, b) => b.rate - a.rate);
  const priorityId = sortedByRate[0]?.id;

  const handleAddDebt = () => {
    const balance = parseFloat(newDebt.balance);
    const rate = parseFloat(newDebt.rate);
    const minPayment = parseFloat(newDebt.minPayment) || 0;
    if (!newDebt.name.trim() || !balance || balance <= 0) return;
    const debt = {
      id: uid(),
      name: newDebt.name.trim(),
      original: balance,
      balance: balance,
      rate: isNaN(rate) ? 0 : rate,
      minPayment,
    };
    update({ ...data, debts: [...data.debts, debt] });
    setNewDebt({ name: "", balance: "", rate: "", minPayment: "" });
    setAddingDebt(false);
  };

  const handleDeleteDebt = (id) => {
    update({
      ...data,
      debts: data.debts.filter((d) => d.id !== id),
      payments: data.payments.filter((p) => p.debtId !== id),
    });
  };

  const openAction = (debtId, mode) => {
    setActionFor({ debtId, mode });
    setAmount("");
    setNote("");
  };

  const handleSubmitEntry = () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0 || !actionFor) return;
    const { debtId, mode } = actionFor;
    const debts = data.debts.map((d) => {
      if (d.id !== debtId) return d;
      if (mode === "payment") return { ...d, balance: Math.max(0, d.balance - amt) };
      // interest accrual increases balance
      return { ...d, balance: d.balance + amt };
    });
    const entry = { id: uid(), debtId, amount: amt, note: note.trim(), date: todayISO(), type: mode };
    update({ ...data, debts, payments: [entry, ...data.payments] });
    setActionFor(null);
    setAmount("");
    setNote("");
  };

  const handleEditEntry = (entry) => {
    const nextAmount = parseFloat(window.prompt("Сума, грн", String(entry.amount)));
    if (!nextAmount || nextAmount <= 0) return;
    const nextNote = window.prompt("Нотатка", entry.note || "");
    if (nextNote === null) return;

    const sign = entryType(entry) === "interest" ? 1 : -1;
    const debts = data.debts.map((debt) =>
      debt.id === entry.debtId
        ? { ...debt, balance: Math.max(0, debt.balance - sign * entry.amount + sign * nextAmount) }
        : debt
    );
    const payments = data.payments.map((payment) =>
      payment.id === entry.id ? { ...payment, amount: nextAmount, note: nextNote.trim() } : payment
    );
    update({ ...data, debts, payments });
  };

  const handleDeleteEntry = (entry) => {
    if (!window.confirm("Видалити цей запис?")) return;

    const sign = entryType(entry) === "interest" ? 1 : -1;
    const debts = data.debts.map((debt) =>
      debt.id === entry.debtId
        ? { ...debt, balance: Math.max(0, debt.balance - sign * entry.amount) }
        : debt
    );
    update({ ...data, debts, payments: data.payments.filter((payment) => payment.id !== entry.id) });
  };

  const exportText = () => {
    const lines = [
      `Стан боргів на ${new Date().toLocaleDateString("uk-UA")}:`,
      ...data.debts.map(
        (d) =>
          `- ${d.name}: залишок ${fmt(d.balance)} грн з ${fmt(d.original)} грн (ставка ${d.rate}%/міс)`
      ),
      `Разом залишок: ${fmt(totalBalance)} грн`,
      `Разом внесено платежів: ${fmt(totalPaid)} грн`,
      `Разом нараховано відсотків: ${fmt(totalInterest)} грн`,
      `Чисте скорочення боргу: ${fmt(netReduction)} грн (${progressPct.toFixed(0)}%)`,
    ];
    return lines.join("\n");
  };

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportText());
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1500);
    } catch (e) {
      setCopyState("idle");
    }
  };

  const debtEntries = (id) => data.payments.filter((p) => p.debtId === id);

  return (
    <div
      style={{ background: "#14202B", fontFamily: "ui-serif, Georgia, serif" }}
      className="rounded-xl p-5 sm:p-7 max-w-2xl mx-auto"
    >
      <div className="flex items-start justify-between mb-6">
        <div>
          <div
            className="text-xs tracking-[0.2em] uppercase mb-1"
            style={{ color: "#C9A24B", fontFamily: "ui-monospace, monospace" }}
          >
            Журнал боргів
          </div>
          <h1 className="text-2xl sm:text-3xl" style={{ color: "#F0EDE6" }}>
            Погашення боргу
          </h1>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div
            className="text-[10px] tracking-wide flex items-center gap-1.5"
            style={{ color: syncState === "offline" ? "#C1666B" : "#8A9BA8", fontFamily: "ui-monospace, monospace" }}
          >
            <span
              className="inline-block rounded-full"
              style={{
                width: 6,
                height: 6,
                background: syncState === "synced" ? "#7FA37F" : syncState === "offline" ? "#C1666B" : "#8A9BA8",
              }}
            />
            {syncState === "synced" ? "синхронізовано" : syncState === "offline" ? "офлайн (локально)" : "з'єднання…"}
          </div>
          <div
            className="text-[10px] tracking-wide"
            style={{ color: saveState === "idle" ? "transparent" : "#8A9BA8", fontFamily: "ui-monospace, monospace" }}
          >
            {saveState === "saving" ? "збереження…" : saveState === "saved" ? "✓ збережено" : "·"}
          </div>
        </div>
      </div>

      <div
        className="rounded-lg p-5 mb-6"
        style={{ background: "#1C2B33", border: "1px solid #26363F" }}
      >
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <div className="text-[11px] tracking-wide uppercase mb-1" style={{ color: "#8A9BA8", fontFamily: "ui-monospace, monospace" }}>
              Залишок боргу
            </div>
            <div
              className="text-3xl sm:text-4xl"
              style={{ color: "#F0EDE6", fontFamily: "ui-monospace, monospace" }}
            >
              {fmt(totalBalance)} <span style={{ color: "#8A9BA8", fontSize: "0.5em" }}>грн</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] tracking-wide uppercase mb-1" style={{ color: "#8A9BA8", fontFamily: "ui-monospace, monospace" }}>
              Прогрес
            </div>
            <div className="text-lg" style={{ color: "#C9A24B", fontFamily: "ui-monospace, monospace" }}>
              {progressPct.toFixed(0)}%
            </div>
          </div>
        </div>
        <div className="h-2 rounded-full mt-4 overflow-hidden" style={{ background: "#26363F" }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%`, background: "linear-gradient(90deg, #8A7233, #C9A24B)" }}
          />
        </div>
        <div className="flex justify-between mt-3 text-[11px] flex-wrap gap-y-1" style={{ color: "#8A9BA8", fontFamily: "ui-monospace, monospace" }}>
          <span className="flex items-center gap-1" style={{ color: "#7FA37F" }}>
            <Banknote size={11} /> внесено {fmt(totalPaid)} грн
          </span>
          <span className="flex items-center gap-1" style={{ color: "#C1666B" }}>
            <Percent size={11} /> нараховано {fmt(totalInterest)} грн
          </span>
          <span>{activeDebts.length} активних</span>
        </div>
      </div>

      <div className="space-y-3 mb-4">
        {data.debts.length === 0 && (
          <div className="text-sm text-center py-8" style={{ color: "#8A9BA8" }}>
            Боргів не додано. Додайте перший нижче.
          </div>
        )}
        {data.debts.map((d) => {
          const pct = d.original > 0 ? Math.max(0, Math.min(100, ((d.original - d.balance) / d.original) * 100)) : 0;
          const isPaidOff = d.balance <= 0.5;
          const isPriority = d.id === priorityId && !isPaidOff;
          const isOpen = expanded === d.id;
          const entries = debtEntries(d.id);
          const isActing = actionFor && actionFor.debtId === d.id;

          return (
            <div
              key={d.id}
              className="rounded-lg overflow-hidden"
              style={{
                background: "#1C2B33",
                border: isPriority ? "1px solid #C9A24B" : "1px solid #26363F",
              }}
            >
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span style={{ color: "#F0EDE6" }} className="text-base">
                        {d.name}
                      </span>
                      {isPriority && (
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wide"
                          style={{ background: "#C9A24B", color: "#14202B", fontFamily: "ui-monospace, monospace" }}
                        >
                          пріоритет
                        </span>
                      )}
                      {isPaidOff && (
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wide flex items-center gap-1"
                          style={{ background: "#3D5A45", color: "#B7D6BC", fontFamily: "ui-monospace, monospace" }}
                        >
                          <Check size={10} /> закрито
                        </span>
                      )}
                    </div>
                    <div
                      className="text-[11px] mt-1"
                      style={{ color: "#8A9BA8", fontFamily: "ui-monospace, monospace" }}
                    >
                      {d.rate}%/міс · мін. платіж {fmt(d.minPayment)} грн
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className="text-xl"
                      style={{ color: isPaidOff ? "#7FA37F" : "#F0EDE6", fontFamily: "ui-monospace, monospace" }}
                    >
                      {fmt(d.balance)}
                    </div>
                    <div className="text-[10px]" style={{ color: "#8A9BA8" }}>
                      з {fmt(d.original)} грн
                    </div>
                  </div>
                </div>

                <div className="h-1.5 rounded-full mt-3 overflow-hidden" style={{ background: "#26363F" }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      background: isPaidOff ? "#7FA37F" : "linear-gradient(90deg, #6b5a2a, #C9A24B)",
                    }}
                  />
                </div>

                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {!isPaidOff && !isActing && (
                    <>
                      <button
                        onClick={() => openAction(d.id, "payment")}
                        className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5"
                        style={{ background: "#26363F", color: "#F0EDE6" }}
                      >
                        <Banknote size={12} /> Платіж
                      </button>
                      <button
                        onClick={() => openAction(d.id, "interest")}
                        className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5"
                        style={{ background: "#26363F", color: "#C1666B" }}
                      >
                        <Percent size={12} /> Відсотки списано
                      </button>
                    </>
                  )}
                  {entries.length > 0 && (
                    <button
                      onClick={() => setExpanded(isOpen ? null : d.id)}
                      className="text-xs flex items-center gap-1"
                      style={{ color: "#8A9BA8" }}
                    >
                      {entries.length} записів {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteDebt(d.id)}
                    className="text-xs ml-auto flex items-center gap-1 opacity-60 hover:opacity-100"
                    style={{ color: "#C1666B" }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {isActing && (
                  <div className="mt-3 p-3 rounded-md flex flex-col gap-2" style={{ background: "#14202B" }}>
                    <div
                      className="text-[10px] uppercase tracking-wide flex items-center gap-1.5"
                      style={{ color: actionFor.mode === "interest" ? "#C1666B" : "#7FA37F", fontFamily: "ui-monospace, monospace" }}
                    >
                      {actionFor.mode === "interest" ? (
                        <>
                          <Percent size={11} /> Нараховані відсотки (збільшить залишок)
                        </>
                      ) : (
                        <>
                          <Banknote size={11} /> Платіж (зменшить залишок)
                        </>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        type="number"
                        inputMode="decimal"
                        placeholder="Сума, грн"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSubmitEntry()}
                        className="flex-1 px-3 py-2 rounded-md text-sm outline-none"
                        style={{ background: "#1C2B33", color: "#F0EDE6", border: "1px solid #26363F" }}
                      />
                      <button
                        onClick={handleSubmitEntry}
                        className="px-3 py-2 rounded-md text-sm"
                        style={{ background: "#C9A24B", color: "#14202B" }}
                      >
                        <Check size={15} />
                      </button>
                      <button
                        onClick={() => setActionFor(null)}
                        className="px-3 py-2 rounded-md text-sm"
                        style={{ background: "#26363F", color: "#8A9BA8" }}
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Нотатка (необов'язково)"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="px-3 py-2 rounded-md text-sm outline-none"
                      style={{ background: "#1C2B33", color: "#F0EDE6", border: "1px solid #26363F" }}
                    />
                  </div>
                )}

                {isOpen && entries.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {entries.map((p) => {
                      const isInterest = entryType(p) === "interest";
                      return (
                        <div
                          key={p.id}
                          className="flex justify-between text-xs px-3 py-1.5 rounded"
                          style={{ background: "#14202B", color: "#8A9BA8", fontFamily: "ui-monospace, monospace" }}
                        >
                          <span className="flex items-center gap-1.5">
                            {isInterest ? <Percent size={10} style={{ color: "#C1666B" }} /> : <Banknote size={10} style={{ color: "#7FA37F" }} />}
                            {p.date}{p.note ? ` · ${p.note}` : ""}
                          </span>
                          <span className="flex items-center gap-1.5" style={{ color: isInterest ? "#C1666B" : "#7FA37F" }}>
                            {isInterest ? "+" : "−"}{fmt(p.amount)} грн
                            <button onClick={() => handleEditEntry(p)} className="p-1 opacity-70 hover:opacity-100" style={{ color: "#8A9BA8" }} aria-label="Редагувати запис"><Pencil size={12} /></button>
                            <button onClick={() => handleDeleteEntry(p)} className="p-1 opacity-70 hover:opacity-100" style={{ color: "#C1666B" }} aria-label="Видалити запис"><Trash2 size={12} /></button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {addingDebt ? (
        <div className="rounded-lg p-4 mb-4" style={{ background: "#1C2B33", border: "1px solid #26363F" }}>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              placeholder="Назва боргу"
              value={newDebt.name}
              onChange={(e) => setNewDebt({ ...newDebt, name: e.target.value })}
              className="col-span-2 px-3 py-2 rounded-md text-sm outline-none"
              style={{ background: "#14202B", color: "#F0EDE6", border: "1px solid #26363F" }}
            />
            <input
              type="number"
              inputMode="decimal"
              placeholder="Сума боргу, грн"
              value={newDebt.balance}
              onChange={(e) => setNewDebt({ ...newDebt, balance: e.target.value })}
              className="px-3 py-2 rounded-md text-sm outline-none"
              style={{ background: "#14202B", color: "#F0EDE6", border: "1px solid #26363F" }}
            />
            <input
              type="number"
              inputMode="decimal"
              placeholder="Ставка, %/міс"
              value={newDebt.rate}
              onChange={(e) => setNewDebt({ ...newDebt, rate: e.target.value })}
              className="px-3 py-2 rounded-md text-sm outline-none"
              style={{ background: "#14202B", color: "#F0EDE6", border: "1px solid #26363F" }}
            />
            <input
              type="number"
              inputMode="decimal"
              placeholder="Мін. платіж, грн"
              value={newDebt.minPayment}
              onChange={(e) => setNewDebt({ ...newDebt, minPayment: e.target.value })}
              className="col-span-2 px-3 py-2 rounded-md text-sm outline-none"
              style={{ background: "#14202B", color: "#F0EDE6", border: "1px solid #26363F" }}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setAddingDebt(false)}
              className="text-xs px-3 py-2 rounded-md"
              style={{ background: "#26363F", color: "#8A9BA8" }}
            >
              Скасувати
            </button>
            <button
              onClick={handleAddDebt}
              className="text-xs px-3 py-2 rounded-md"
              style={{ background: "#C9A24B", color: "#14202B" }}
            >
              Додати борг
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAddingDebt(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm mb-4 transition-colors"
          style={{ background: "#1C2B33", color: "#8A9BA8", border: "1px dashed #26363F" }}
        >
          <Plus size={15} /> Додати борг
        </button>
      )}

      <div className="pt-2" style={{ borderTop: "1px solid #26363F" }}>
        <button
          onClick={() => setShowExport(!showExport)}
          className="text-xs flex items-center gap-1.5 mt-3"
          style={{ color: "#8A9BA8", fontFamily: "ui-monospace, monospace" }}
        >
          <TrendingDown size={13} /> Експорт стану для чату
        </button>
        {showExport && (
          <div className="mt-2 p-3 rounded-md" style={{ background: "#1C2B33" }}>
            <pre
              className="text-[11px] whitespace-pre-wrap mb-2"
              style={{ color: "#F0EDE6", fontFamily: "ui-monospace, monospace" }}
            >
              {exportText()}
            </pre>
            <button
              onClick={copyExport}
              className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5"
              style={{ background: "#26363F", color: "#F0EDE6" }}
            >
              <Copy size={12} /> {copyState === "copied" ? "Скопійовано!" : "Копіювати"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
