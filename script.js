/* ===========================================================
   复利计算器 · Claude UI 风格
   - 多货币（ExchangeRate-API /latest/{base}）
   - 时长支持 年 / 月 / 天
   - 自定义下拉（替代原生 select）
   - 一键导出 PNG
   =========================================================== */

const $ = (id) => document.getElementById(id);

/* ---------- 货币 ---------- */
const FX_API_KEY_STORAGE = "fx_api_key_v1";

function loadApiKey() {
  try {
    return localStorage.getItem(FX_API_KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

function saveApiKey(k) {
  try {
    if (k) localStorage.setItem(FX_API_KEY_STORAGE, k);
    else localStorage.removeItem(FX_API_KEY_STORAGE);
  } catch {}
}

let FX_API_KEY = loadApiKey();
const FX_BASE = "USD"; // 我们以 USD 为锚点缓存所有汇率

const CURRENCIES = [
  { code: "CNY", symbol: "¥",   name: "人民币",     locale: "zh-CN" },
  { code: "USD", symbol: "$",   name: "美元",       locale: "en-US" },
  { code: "EUR", symbol: "€",   name: "欧元",       locale: "de-DE" },
  { code: "GBP", symbol: "£",   name: "英镑",       locale: "en-GB" },
  { code: "JPY", symbol: "¥",   name: "日元",       locale: "ja-JP" },
  { code: "HKD", symbol: "HK$", name: "港币",       locale: "zh-HK" },
  { code: "SGD", symbol: "S$",  name: "新加坡元",   locale: "en-SG" },
  { code: "AUD", symbol: "A$",  name: "澳元",       locale: "en-AU" },
  { code: "CAD", symbol: "C$",  name: "加元",       locale: "en-CA" },
  { code: "KRW", symbol: "₩",   name: "韩元",       locale: "ko-KR" },
];

let currentCurrency = "USD";
let usdRates = null; // { CNY: x, EUR: y, ... }
let ratesLoadedAt = 0;

const currencyMeta = (code) =>
  CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];

function fmtMoney(value) {
  const meta = currencyMeta(currentCurrency);
  const v = Math.round(Number(value) || 0);
  try {
    return new Intl.NumberFormat(meta.locale, {
      style: "currency",
      currency: currentCurrency,
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return meta.symbol + v.toLocaleString();
  }
}

function fmtMoneyCompact(value) {
  const meta = currencyMeta(currentCurrency);
  const v = Number(value) || 0;
  try {
    return new Intl.NumberFormat(meta.locale, {
      style: "currency",
      currency: currentCurrency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);
  } catch {
    return meta.symbol + Math.round(v).toLocaleString();
  }
}

/* ---------- FX ---------- */
async function loadRates(force = false) {
  if (!FX_API_KEY) {
    throw new Error("尚未配置 API Key");
  }
  // 缓存 1 小时
  const fresh = usdRates && Date.now() - ratesLoadedAt < 3600 * 1000;
  if (fresh && !force) return usdRates;

  const url = `https://v6.exchangerate-api.com/v6/${FX_API_KEY}/latest/${FX_BASE}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.result !== "success") {
    throw new Error(data["error-type"] || "汇率获取失败");
  }
  usdRates = data.conversion_rates;
  ratesLoadedAt = Date.now();
  return usdRates;
}

async function getRate(from, to) {
  if (from === to) return 1;
  const rates = await loadRates();
  const fr = rates[from];
  const tr = rates[to];
  if (!fr || !tr) throw new Error(`不支持的货币：${!fr ? from : to}`);
  return tr / fr;
}

function setRateStatus(text, kind = "") {
  const el = $("rateStatus");
  el.className = "rate-status" + (kind ? " is-" + kind : "");
  el.textContent = text;
}

async function switchCurrency(newCode) {
  if (newCode === currentCurrency) return;
  if (!FX_API_KEY) {
    const sel = $("currency");
    sel.value = currentCurrency;
    if (sel._refreshCustom) sel._refreshCustom();
    openApiKeyModal({ reason: "missing" });
    return;
  }
  const oldCode = currentCurrency;
  setRateStatus("更新中…", "loading");
  try {
    const rate = await getRate(oldCode, newCode);

    const principalEl = $("principal");
    const contribEl = $("contribution");
    principalEl.value = Math.max(0, Math.round(Number(principalEl.value) * rate));
    contribEl.value = Math.max(0, Math.round(Number(contribEl.value) * rate));

    // 同步换算目标版块的金额
    const tp = $("targetPrincipal");
    const tg = $("targetGoal");
    if (tp) tp.value = Math.max(0, Math.round(Number(tp.value) * rate));
    if (tg) tg.value = Math.max(0, Math.round(Number(tg.value) * rate));

    currentCurrency = newCode;
    updateCurrencyUI();
    setRateStatus(`1 ${oldCode} ≈ ${rate.toFixed(4)} ${newCode}`);
    compute();
    if (typeof computeTarget === "function") computeTarget();
  } catch (err) {
    // 回滚选择
    const sel = $("currency");
    sel.value = oldCode;
    if (sel._refreshCustom) sel._refreshCustom();
    setRateStatus("汇率获取失败：" + err.message, "error");
    showToast("汇率获取失败：" + err.message, true);
  }
}

function updateCurrencyUI() {
  const meta = currencyMeta(currentCurrency);
  $("prefixPrincipal").textContent = meta.symbol;
  $("prefixContribution").textContent = meta.symbol;
  $("hintCurrency").textContent = `${meta.name} (${meta.code})`;
}

/* ---------- API Key 模态框 ---------- */
function openApiKeyModal(opts = {}) {
  const modal = $("apiKeyModal");
  const input = $("apiKeyInput");
  const tip = $("apiKeyTip");
  input.value = FX_API_KEY || "";
  if (opts.reason === "missing") {
    tip.className = "modal-tip is-warn";
    tip.textContent = "切换货币需要先配置 ExchangeRate-API 的 Key。";
  } else if (opts.reason === "error") {
    tip.className = "modal-tip is-warn";
    tip.textContent = opts.message || "Key 校验失败，请检查后重试。";
  } else {
    tip.className = "modal-tip";
    tip.textContent = "Key 仅保存在你的浏览器本地，不会上传到任何服务器。";
  }
  modal.classList.add("is-open");
  setTimeout(() => input.focus(), 50);
}

function closeApiKeyModal() {
  $("apiKeyModal").classList.remove("is-open");
}

async function testAndSaveApiKey() {
  const key = $("apiKeyInput").value.trim();
  const tip = $("apiKeyTip");
  if (!key) {
    saveApiKey("");
    FX_API_KEY = "";
    usdRates = null;
    setRateStatus("");
    tip.className = "modal-tip";
    tip.textContent = "已清除 API Key。";
    closeApiKeyModal();
    return;
  }
  tip.className = "modal-tip is-loading";
  tip.textContent = "正在校验…";
  try {
    const url = `https://v6.exchangerate-api.com/v6/${key}/latest/USD`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.result !== "success") {
      throw new Error(data["error-type"] || "校验失败");
    }
    FX_API_KEY = key;
    saveApiKey(key);
    usdRates = data.conversion_rates;
    ratesLoadedAt = Date.now();
    setRateStatus("API Key 已保存");
    showToast("API Key 已保存");
    closeApiKeyModal();
  } catch (err) {
    tip.className = "modal-tip is-warn";
    tip.textContent = "校验失败：" + err.message;
  }
}

/* ---------- 自定义下拉 ---------- */
function enhanceSelect(sel, opts = {}) {
  const variant = sel.dataset.cs || opts.variant || "default";

  const wrap = document.createElement("div");
  wrap.className = `cs-select cs-${variant}`;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "cs-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  if (sel.getAttribute("aria-label")) {
    trigger.setAttribute("aria-label", sel.getAttribute("aria-label"));
  }

  const valueEl = document.createElement("span");
  valueEl.className = "cs-value";

  const arrow = document.createElement("span");
  arrow.className = "cs-arrow";
  arrow.innerHTML =
    '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4 L6 8 L10 4"/></svg>';

  trigger.append(valueEl, arrow);

  const menu = document.createElement("div");
  menu.className = "cs-menu";
  menu.setAttribute("role", "listbox");

  const renderOption = (opt) => {
    const item = document.createElement("div");
    item.className = "cs-option";
    item.dataset.value = opt.value;
    item.setAttribute("role", "option");
    if (opt.dataset.label) {
      // pill variant: code | name | symbol
      const [code, name, symbol] = opt.dataset.label.split("|");
      item.innerHTML = `<span class="opt-code">${code}</span><span class="opt-name">${name}</span><span class="opt-symbol">${symbol}</span>`;
    } else {
      item.textContent = opt.textContent;
    }
    if (opt.selected) item.classList.add("is-selected");
    item.addEventListener("click", () => {
      sel.value = opt.value;
      syncTriggerLabel();
      menu.querySelectorAll(".cs-option").forEach((o) =>
        o.classList.remove("is-selected")
      );
      item.classList.add("is-selected");
      close();
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      sel.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return item;
  };

  const buildOptions = () => {
    menu.innerHTML = "";
    Array.from(sel.options).forEach((opt) => menu.appendChild(renderOption(opt)));
  };

  const syncTriggerLabel = () => {
    const opt = sel.options[sel.selectedIndex];
    if (!opt) {
      valueEl.textContent = "";
      return;
    }
    if (opt.dataset.label) {
      const [code, , symbol] = opt.dataset.label.split("|");
      valueEl.innerHTML = `<span class="opt-code" style="font-family:SFMono-Regular,Menlo,Consolas,monospace;font-weight:500">${code}</span> <span style="color:var(--ink-mute)">${symbol}</span>`;
    } else {
      valueEl.textContent = opt.textContent;
    }
  };

  buildOptions();
  syncTriggerLabel();

  let isOpen = false;
  const open = () => {
    if (isOpen) return;
    isOpen = true;
    wrap.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
  };
  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    wrap.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onOutside);
    document.removeEventListener("keydown", onKey);
  };
  const onOutside = (e) => {
    if (!wrap.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };

  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    isOpen ? close() : open();
  });

  wrap.appendChild(trigger);
  wrap.appendChild(menu);
  sel.parentNode.insertBefore(wrap, sel.nextSibling);

  // 暴露刷新（用于动态修改 options 后）
  sel._refreshCustom = () => {
    buildOptions();
    syncTriggerLabel();
  };

  return wrap;
}

function initCustomSelects() {
  // 货币：先注入选项再 enhance
  const currencySel = $("currency");
  currencySel.innerHTML = CURRENCIES.map(
    (c) =>
      `<option value="${c.code}" data-label="${c.code}|${c.name}|${c.symbol}"${
        c.code === currentCurrency ? " selected" : ""
      }></option>`
  ).join("");

  document.querySelectorAll("select[data-cs]").forEach((s) => enhanceSelect(s));

  currencySel.addEventListener("change", (e) => switchCurrency(e.target.value));
}

/* ---------- Toast ---------- */
let toastEl = null;
function showToast(msg, isError = false) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.className = "toast is-show" + (isError ? " is-error" : "");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => {
    toastEl.className = "toast" + (isError ? " is-error" : "");
  }, 2200);
}

/* ---------- 输入 / 模拟 ---------- */
const UNIT_INFO = {
  years:  { perYear: 1,   label: "年",  abbr: "y" },
  months: { perYear: 12,  label: "月",  abbr: "mo" },
  days:   { perYear: 365, label: "天",  abbr: "d" },
};

function readInputs() {
  const principal = Math.max(0, Number($("principal").value) || 0);
  const contribution = Math.max(0, Number($("contribution").value) || 0);
  const rateRaw = Math.max(0, Number($("rate").value) || 0) / 100;
  const rateUnit = $("rateUnit").value; // years / months / days
  // 统一换算到年利率：月利率 × 12，日利率 × 365
  const rate = rateRaw * UNIT_INFO[rateUnit].perYear;
  const duration = Math.max(1, Math.round(Number($("duration").value) || 1));
  const unit = $("durationUnit").value;
  const totalYears = duration / UNIT_INFO[unit].perYear;
  // 复利频率 = 利率周期：年利率 → 每年复利，月利率 → 每月，日利率 → 每天
  const n = UNIT_INFO[rateUnit].perYear;
  const timing = $("contribTiming").value === "start" ? 1 : 0;
  return {
    principal, contribution,
    rate, rateRaw, rateUnit,
    duration, unit, totalYears,
    n, timing,
  };
}

function simulate({ principal, contribution, rate, totalYears, n, timing }) {
  const periodRate = rate / n;
  const totalPeriodsExact = totalYears * n;
  const fullPeriods = Math.floor(totalPeriodsExact + 1e-9);
  const fractional = totalPeriodsExact - fullPeriods;

  let balance = principal;
  let cumContrib = principal;
  let cumInterest = 0;

  const snapshots = [{ elapsedYears: 0, balance, cumContrib, cumInterest }];

  for (let p = 1; p <= fullPeriods; p++) {
    if (timing === 1 && contribution > 0) {
      balance += contribution;
      cumContrib += contribution;
    }
    const interest = balance * periodRate;
    balance += interest;
    cumInterest += interest;
    if (timing === 0 && contribution > 0) {
      balance += contribution;
      cumContrib += contribution;
    }
    snapshots.push({ elapsedYears: p / n, balance, cumContrib, cumInterest });
  }

  if (fractional > 1e-9) {
    const interest = balance * periodRate * fractional;
    balance += interest;
    cumInterest += interest;
    snapshots.push({ elapsedYears: totalYears, balance, cumContrib, cumInterest });
  }

  return {
    finalAmount: balance,
    totalContrib: cumContrib,
    totalInterest: cumInterest,
    snapshots,
  };
}

function buildBreakdown(snapshots, unit, duration) {
  const info = UNIT_INFO[unit];
  const step = Math.max(1, Math.ceil(duration / 30));

  const targets = [];
  for (let k = step; k < duration; k += step) targets.push(k);
  targets.push(duration);

  const rows = [];
  let prev = snapshots[0];
  let prevTarget = 0;

  for (const t of targets) {
    const targetYears = t / info.perYear;
    let chosen = snapshots[0];
    for (const s of snapshots) {
      if (s.elapsedYears <= targetYears + 1e-9) chosen = s;
      else break;
    }
    rows.push({
      label:
        step === 1
          ? `第 ${t} ${info.label}`
          : `第 ${prevTarget + 1}–${t} ${info.label}`,
      contribInRow: chosen.cumContrib - prev.cumContrib,
      cumContrib: chosen.cumContrib,
      interestInRow: chosen.cumInterest - prev.cumInterest,
      cumInterest: chosen.cumInterest,
      balance: chosen.balance,
    });
    prev = chosen;
    prevTarget = t;
  }
  return rows;
}

/* ---------- 渲染 ---------- */
function renderResult(result, inputs) {
  $("finalAmount").textContent = fmtMoney(result.finalAmount);
  $("totalContributed").textContent = fmtMoney(result.totalContrib);
  $("totalInterest").textContent = fmtMoney(result.totalInterest);
  $("multiple").textContent =
    result.totalContrib > 0
      ? (result.finalAmount / result.totalContrib).toFixed(2) + "×"
      : "—";

  const rows = buildBreakdown(result.snapshots, inputs.unit, inputs.duration);
  renderTable(rows);
  drawChart(result.snapshots, inputs);
}

function renderTable(rows) {
  const tbody = document.querySelector("#yearTable tbody");
  tbody.innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td>${r.label}</td>
        <td>${fmtMoney(r.contribInRow)}</td>
        <td>${fmtMoney(r.cumContrib)}</td>
        <td>${fmtMoney(r.interestInRow)}</td>
        <td>${fmtMoney(r.cumInterest)}</td>
        <td><strong>${fmtMoney(r.balance)}</strong></td>
      </tr>`
    )
    .join("");
}

/* ---------- Canvas Chart ---------- */
function drawChartOn(ctx, x, y, w, h, snapshots, inputs, opts = {}) {
  const padL = opts.padL ?? 56;
  const padR = opts.padR ?? 14;
  const padT = opts.padT ?? 14;
  const padB = opts.padB ?? 28;
  const cw = w - padL - padR;
  const ch = h - padT - padB;
  const ox = x + padL;
  const oy = y + padT;

  const info = UNIT_INFO[inputs.unit];
  const points = snapshots.map((s) => ({
    xUnit: s.elapsedYears * info.perYear,
    balance: s.balance,
    contrib: s.cumContrib,
  }));

  const maxX = inputs.duration || 1;
  const maxY =
    Math.max(...points.map((p) => p.balance), inputs.principal || 0) || 1;

  const xAt = (xUnit) => ox + (xUnit / maxX) * cw;
  const yAt = (val) => oy + ch - (val / maxY) * ch;

  // grid
  ctx.strokeStyle = "#e7dfd3";
  ctx.lineWidth = 1;
  ctx.font = `${opts.fontSize ?? 11}px "Inter", -apple-system, sans-serif`;
  ctx.fillStyle = "#8a8079";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const v = (maxY / gridLines) * i;
    const yv = yAt(v);
    ctx.beginPath();
    ctx.moveTo(ox, yv);
    ctx.lineTo(ox + cw, yv);
    ctx.stroke();
    ctx.fillText(fmtMoneyCompact(v), ox - 8, yv);
  }

  // x labels
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const xStep = Math.max(1, Math.ceil(maxX / 6));
  for (let xv = 0; xv <= maxX; xv += xStep) {
    ctx.fillText(xv + info.abbr, xAt(xv), oy + ch + 8);
  }
  if (maxX % xStep !== 0) {
    ctx.fillText(maxX + info.abbr, xAt(maxX), oy + ch + 8);
  }

  // contributed area
  ctx.beginPath();
  points.forEach((p, i) => {
    const px = xAt(p.xUnit);
    const py = yAt(p.contrib);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.lineTo(xAt(points[points.length - 1].xUnit), yAt(0));
  ctx.lineTo(xAt(points[0].xUnit), yAt(0));
  ctx.closePath();
  ctx.fillStyle = "rgba(138, 128, 121, 0.10)";
  ctx.fill();

  // total area
  const grad = ctx.createLinearGradient(0, oy, 0, oy + ch);
  grad.addColorStop(0, "rgba(204, 120, 92, 0.32)");
  grad.addColorStop(1, "rgba(204, 120, 92, 0.02)");
  ctx.beginPath();
  points.forEach((p, i) => {
    const px = xAt(p.xUnit);
    const py = yAt(p.balance);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.lineTo(xAt(points[points.length - 1].xUnit), yAt(0));
  ctx.lineTo(xAt(points[0].xUnit), yAt(0));
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // contributed line dashed
  ctx.beginPath();
  points.forEach((p, i) => {
    const px = xAt(p.xUnit);
    const py = yAt(p.contrib);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.strokeStyle = "#8a8079";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // total line
  ctx.beginPath();
  points.forEach((p, i) => {
    const px = xAt(p.xUnit);
    const py = yAt(p.balance);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.strokeStyle = "#cc785c";
  ctx.lineWidth = 2.2;
  ctx.lineJoin = "round";
  ctx.stroke();

  // end dot
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(xAt(last.xUnit), yAt(last.balance), 4, 0, Math.PI * 2);
  ctx.fillStyle = "#cc785c";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawChart(snapshots, inputs) {
  const canvas = $("growthChart");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (!cssW || !cssH) return;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  drawChartOn(ctx, 0, 0, cssW, cssH, snapshots, inputs);
}

/* ---------- 品牌 logo（用于导出图片） ---------- */
const BRAND_NAME = "集智芬享";
const BRAND_LOGO_URL = "logo.png";

let brandLogoImg = null;
function preloadBrandLogo() {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    brandLogoImg = img;
  };
  img.onerror = () => {
    brandLogoImg = null;
  };
  img.src = BRAND_LOGO_URL;
}

/* ---------- 导出 PNG ---------- */
function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function exportImage() {
  if (!lastInputs || !lastResult) return;
  const inputs = lastInputs;
  const result = lastResult;
  const rows = buildBreakdown(result.snapshots, inputs.unit, inputs.duration);

  const W = 1100;
  const padX = 48;
  const headerH = 168;
  const summaryH = 110;
  const chartH = 360;
  const tableHeaderH = 44;
  const tableRowH = 38;
  const tableH = tableHeaderH + rows.length * tableRowH;
  const sectionGap = 28;
  const footerH = 60;

  const H =
    headerH +
    summaryH +
    sectionGap +
    chartH +
    sectionGap +
    tableH +
    footerH;

  const dpr = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  // bg
  ctx.fillStyle = "#f5f1ea";
  ctx.fillRect(0, 0, W, H);

  // ---- Header ----
  let cy = 36;
  // brand row: logo + name (small)
  const brandY = cy;
  const logoSize = 22;
  let brandTextX = padX;
  if (brandLogoImg) {
    ctx.save();
    roundedRect(ctx, padX, brandY - 4, logoSize, logoSize, 6);
    ctx.clip();
    ctx.drawImage(brandLogoImg, padX, brandY - 4, logoSize, logoSize);
    ctx.restore();
    brandTextX = padX + logoSize + 8;
  }
  ctx.fillStyle = "#5b524b";
  ctx.font = '600 12px "Inter", "PingFang SC", sans-serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(BRAND_NAME, brandTextX, brandY + logoSize / 2 - 4);
  // separator dot + tagline
  const brandW = ctx.measureText(BRAND_NAME).width;
  ctx.fillStyle = "#8a8079";
  ctx.font = '500 11px "Inter", sans-serif';
  ctx.fillText("·  COMPOUND INTEREST", brandTextX + brandW + 8, brandY + logoSize / 2 - 4);

  cy += 38;

  ctx.fillStyle = "#2b2724";
  ctx.font = '600 36px "Source Serif 4", Georgia, serif';
  ctx.textBaseline = "top";
  ctx.fillText("复利计算结果", padX, cy);

  // top right: date + currency
  const dateStr = new Date().toLocaleDateString(currencyMeta(currentCurrency).locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  ctx.textAlign = "right";
  ctx.fillStyle = "#5b524b";
  ctx.font = '500 13px "Inter", sans-serif';
  ctx.fillText(dateStr, W - padX, 36);
  ctx.fillStyle = "#cc785c";
  ctx.font = '600 14px "Inter", sans-serif';
  ctx.fillText(`${currencyMeta(currentCurrency).name} · ${currentCurrency}`, W - padX, 56);

  // input summary line
  cy += 50;
  ctx.fillStyle = "#5b524b";
  ctx.font = '400 13.5px "Inter", sans-serif';
  ctx.textAlign = "left";
  const meta = currencyMeta(currentCurrency);
  const summary = `本金 ${fmtMoney(inputs.principal)}  ·  每期追加 ${fmtMoney(
    inputs.contribution
  )}  ·  ${UNIT_INFO[inputs.rateUnit].label}利率 ${(inputs.rateRaw * 100).toFixed(3)}%  ·  时长 ${
    inputs.duration
  } ${UNIT_INFO[inputs.unit].label}`;
  ctx.fillText(summary, padX, cy);

  // ---- Summary boxes ----
  cy = headerH;
  const stats = [
    { label: "期末总金额", value: fmtMoney(result.finalAmount), accent: false, big: true },
    { label: "本金合计", value: fmtMoney(result.totalContrib) },
    { label: "利息收益", value: fmtMoney(result.totalInterest), accent: true },
    {
      label: "收益倍数",
      value:
        result.totalContrib > 0
          ? (result.finalAmount / result.totalContrib).toFixed(2) + "×"
          : "—",
    },
  ];

  const innerW = W - padX * 2;
  const gap = 14;
  const bigW = innerW * 0.34;
  const restW = (innerW - bigW - gap * 3) / 3;
  const boxH = summaryH - 10;

  let bx = padX;
  stats.forEach((s, i) => {
    const bw = i === 0 ? bigW : restW;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#e7dfd3";
    ctx.lineWidth = 1;
    roundedRect(ctx, bx, cy, bw, boxH, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#8a8079";
    ctx.font = '500 11px "Inter", sans-serif';
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(s.label.toUpperCase(), bx + 18, cy + 16);

    ctx.fillStyle = s.accent ? "#cc785c" : "#2b2724";
    ctx.font = `600 ${s.big ? 30 : 22}px "Source Serif 4", Georgia, serif`;
    ctx.fillText(s.value, bx + 18, cy + 38);

    bx += bw + gap;
  });

  // ---- Chart ----
  cy = headerH + summaryH + sectionGap;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#e7dfd3";
  roundedRect(ctx, padX, cy, innerW, chartH, 18);
  ctx.fill();
  ctx.stroke();

  // chart title
  ctx.fillStyle = "#2b2724";
  ctx.font = '600 18px "Source Serif 4", Georgia, serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("资产增长曲线", padX + 24, cy + 22);

  // legend
  ctx.font = '400 12px "Inter", sans-serif';
  ctx.fillStyle = "#5b524b";
  let lx = W - padX - 24;
  ctx.textAlign = "right";
  ctx.fillText("资产总额", lx, cy + 26);
  ctx.fillStyle = "#cc785c";
  ctx.beginPath();
  ctx.arc(lx - ctx.measureText("资产总额").width - 8, cy + 32, 5, 0, Math.PI * 2);
  ctx.fill();
  lx -= ctx.measureText("资产总额").width + 38;
  ctx.fillStyle = "#5b524b";
  ctx.fillText("本金累计", lx, cy + 26);
  ctx.fillStyle = "#8a8079";
  ctx.beginPath();
  ctx.arc(lx - ctx.measureText("本金累计").width - 8, cy + 32, 5, 0, Math.PI * 2);
  ctx.fill();

  // chart body
  drawChartOn(
    ctx,
    padX + 12,
    cy + 56,
    innerW - 24,
    chartH - 76,
    result.snapshots,
    inputs,
    { padL: 70, padR: 24, padT: 12, padB: 28, fontSize: 12 }
  );

  // ---- Table ----
  cy += chartH + sectionGap;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#e7dfd3";
  roundedRect(ctx, padX, cy, innerW, tableH, 18);
  ctx.fill();
  ctx.stroke();

  // table header
  ctx.save();
  // clip top corners
  ctx.fillStyle = "#faf7f2";
  roundedRect(ctx, padX, cy, innerW, tableHeaderH, 18);
  ctx.clip();
  ctx.fillRect(padX, cy + tableHeaderH - 20, innerW, 20);
  ctx.restore();
  // re-fill header area cleanly
  ctx.fillStyle = "#faf7f2";
  ctx.beginPath();
  ctx.moveTo(padX + 18, cy);
  ctx.lineTo(padX + innerW - 18, cy);
  ctx.arcTo(padX + innerW, cy, padX + innerW, cy + 18, 18);
  ctx.lineTo(padX + innerW, cy + tableHeaderH);
  ctx.lineTo(padX, cy + tableHeaderH);
  ctx.lineTo(padX, cy + 18);
  ctx.arcTo(padX, cy, padX + 18, cy, 18);
  ctx.closePath();
  ctx.fill();

  const cols = [
    { label: "时段", align: "left", width: 0.20 },
    { label: "当期投入", align: "right", width: 0.16 },
    { label: "累计投入", align: "right", width: 0.16 },
    { label: "当期利息", align: "right", width: 0.16 },
    { label: "累计利息", align: "right", width: 0.16 },
    { label: "期末总额", align: "right", width: 0.16 },
  ];
  const tableX = padX + 24;
  const tableW = innerW - 48;
  const colXs = [];
  let cursor = tableX;
  cols.forEach((c) => {
    colXs.push(cursor);
    cursor += tableW * c.width;
  });
  const colEnds = colXs.map((x, i) => x + tableW * cols[i].width);

  ctx.fillStyle = "#8a8079";
  ctx.font = '500 11px "Inter", sans-serif';
  ctx.textBaseline = "middle";
  cols.forEach((c, i) => {
    ctx.textAlign = c.align;
    const tx = c.align === "right" ? colEnds[i] - 4 : colXs[i];
    ctx.fillText(c.label.toUpperCase(), tx, cy + tableHeaderH / 2);
  });

  // separator
  ctx.strokeStyle = "#e7dfd3";
  ctx.beginPath();
  ctx.moveTo(padX, cy + tableHeaderH);
  ctx.lineTo(padX + innerW, cy + tableHeaderH);
  ctx.stroke();

  // rows
  rows.forEach((r, idx) => {
    const ry = cy + tableHeaderH + idx * tableRowH;
    if (idx % 2 === 0) {
      ctx.fillStyle = "#fdfaf4";
      ctx.fillRect(padX + 1, ry, innerW - 2, tableRowH);
    }

    ctx.font = '400 13px "Inter", sans-serif';
    ctx.fillStyle = "#5b524b";
    ctx.textAlign = "left";
    ctx.fillText(r.label, colXs[0], ry + tableRowH / 2);

    const cells = [
      r.contribInRow,
      r.cumContrib,
      r.interestInRow,
      r.cumInterest,
    ];
    ctx.fillStyle = "#2b2724";
    cells.forEach((val, i) => {
      ctx.textAlign = "right";
      ctx.fillText(fmtMoney(val), colEnds[i + 1] - 4, ry + tableRowH / 2);
    });

    ctx.font = '600 13px "Inter", sans-serif';
    ctx.fillStyle = "#2b2724";
    ctx.textAlign = "right";
    ctx.fillText(fmtMoney(r.balance), colEnds[5] - 4, ry + tableRowH / 2);

    if (idx < rows.length - 1) {
      ctx.strokeStyle = "#f0e9dd";
      ctx.beginPath();
      ctx.moveTo(padX + 24, ry + tableRowH);
      ctx.lineTo(padX + innerW - 24, ry + tableRowH);
      ctx.stroke();
    }
  });

  // ---- Footer ----
  const fy = H - footerH + 14;
  ctx.fillStyle = "#8a8079";
  ctx.font = '400 12px "Inter", sans-serif';
  ctx.textAlign = "left";
  ctx.fillText("© 集智芬享  ·  仅供参考，结果不代表实际投资收益", padX, fy);
  ctx.textAlign = "right";
  ctx.font = 'italic 12px "Source Serif 4", Georgia, serif';
  ctx.fillText(
    "The most powerful force in the universe is compound interest.",
    W - padX,
    fy
  );

  // download
  canvas.toBlob((blob) => {
    if (!blob) {
      if (brandLogoImg) {
        brandLogoImg = null;
        showToast("正在重试导出…");
        exportImage();
        return;
      }
      showToast("导出失败", true);
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const ts = new Date().toISOString().slice(0, 10);
    a.download = `复利计算-${currentCurrency}-${ts}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showToast("已导出图片");
  }, "image/png");
}

/* ---------- 目标利率反推 ---------- */
let targetUnitView = "years";

function computeTarget() {
  const principal = Math.max(0, Number($("targetPrincipal").value) || 0);
  const goal = Math.max(0, Number($("targetGoal").value) || 0);
  const duration = Math.max(1, Math.round(Number($("targetDuration").value) || 1));
  const unit = $("targetDurationUnit").value;
  const totalYears = duration / UNIT_INFO[unit].perYear;
  // 复利频率 = 当前 Tab 选择的利率周期
  const n = UNIT_INFO[targetUnitView].perYear;

  const meta = currencyMeta(currentCurrency);
  $("prefixTargetPrincipal").textContent = meta.symbol;
  $("prefixTargetGoal").textContent = meta.symbol;

  const labelMap = { years: "年利率", months: "月利率", days: "日利率" };
  $("targetRateLabel").textContent = labelMap[targetUnitView];

  const hintEl = $("targetHint");
  const valueEl = $("targetRateValue");

  // 边界处理
  if (principal <= 0) {
    valueEl.textContent = "—";
    $("targetRateYear").textContent = "—";
    $("targetRateMonth").textContent = "—";
    $("targetRateDay").textContent = "—";
    hintEl.className = "target-hint is-warn";
    hintEl.textContent = "请输入大于 0 的初始本金。";
    return;
  }
  if (goal <= principal) {
    valueEl.textContent = "0%";
    $("targetRateYear").textContent = "0%";
    $("targetRateMonth").textContent = "0%";
    $("targetRateDay").textContent = "0%";
    hintEl.className = "target-hint";
    hintEl.textContent =
      goal === principal
        ? "目标金额与本金相同，无需任何利率。"
        : "目标金额已经低于本金。";
    return;
  }

  // 在所选粒度下，每期 (1 年内 n 期) 的实际增长因子
  // FV = P × g^(n·t) ⇒ g = (Goal/P)^(1/(n·t))
  // 名义"周期利率" = g - 1
  // 名义"年利率" = n × (g - 1)
  const totalPeriods = n * totalYears;
  const periodGrowth = Math.pow(goal / principal, 1 / totalPeriods);
  const annualRate = n * (periodGrowth - 1);

  const yearRate = annualRate;
  const monthRate = annualRate / 12;
  const dayRate = annualRate / 365;

  const fmt = (r) => {
    const pct = r * 100;
    if (pct >= 1) return pct.toFixed(2) + "%";
    if (pct >= 0.01) return pct.toFixed(3) + "%";
    return pct.toFixed(5) + "%";
  };

  $("targetRateYear").textContent = fmt(yearRate);
  $("targetRateMonth").textContent = fmt(monthRate);
  $("targetRateDay").textContent = fmt(dayRate);

  // 高亮当前所选粒度
  const cards = {
    years: $("targetRateYear"),
    months: $("targetRateMonth"),
    days: $("targetRateDay"),
  };
  Object.entries(cards).forEach(([k, el]) => {
    el.classList.toggle("accent", k === targetUnitView);
  });

  const viewMap = { years: yearRate, months: monthRate, days: dayRate };
  valueEl.textContent = fmt(viewMap[targetUnitView]);

  // hint
  const yrsText =
    unit === "years"
      ? `${duration} 年`
      : `${duration} ${UNIT_INFO[unit].label}（约 ${totalYears.toFixed(2)} 年）`;
  const periodLabel = UNIT_INFO[targetUnitView].label;
  hintEl.className = "target-hint";
  hintEl.textContent = `从 ${fmtMoney(principal)} 增长到 ${fmtMoney(
    goal
  )}，在 ${yrsText}内按${periodLabel}复利，每${periodLabel}需要约 ${fmt(
    viewMap[targetUnitView]
  )}（≈ 年利率 ${fmt(yearRate)}）。`;
}

function setupTargetSection() {
  const form = $("target-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    computeTarget();
  });
  form.addEventListener("input", computeTarget);
  form.addEventListener("change", computeTarget);
  $("target-reset").addEventListener("click", () => {
    setTimeout(() => {
      document
        .querySelectorAll("#target-form select[data-cs]")
        .forEach((s) => s._refreshCustom && s._refreshCustom());
      computeTarget();
    }, 0);
  });

  document.querySelectorAll(".rate-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".rate-tab")
        .forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      targetUnitView = btn.dataset.unit;
      computeTarget();
    });
  });

  computeTarget();
}

/* ---------- 主流程 ---------- */
let lastInputs = null;
let lastResult = null;

function compute() {
  const inputs = readInputs();
  const result = simulate(inputs);
  lastInputs = inputs;
  lastResult = result;
  renderResult(result, inputs);
}

function setup() {
  initCustomSelects();
  updateCurrencyUI();
  preloadBrandLogo();

  const form = $("calc-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    compute();
  });
  form.addEventListener("input", (e) => {
    if (e.target && e.target.id === "currency") return;
    compute();
  });
  form.addEventListener("change", (e) => {
    if (e.target && e.target.id === "currency") return;
    compute();
  });
  $("reset-btn").addEventListener("click", () => {
    setTimeout(() => {
      // 重置后让自定义下拉同步
      document.querySelectorAll("select[data-cs]").forEach((s) => {
        if (s._refreshCustom) s._refreshCustom();
      });
      compute();
    }, 0);
  });

  $("exportBtn").addEventListener("click", exportImage);

  // API Key 模态框
  $("apiKeyBtn").addEventListener("click", () => openApiKeyModal());
  $("apiKeySave").addEventListener("click", testAndSaveApiKey);
  $("apiKeyCancel").addEventListener("click", closeApiKeyModal);
  $("apiKeyClear").addEventListener("click", () => {
    $("apiKeyInput").value = "";
  });
  $("apiKeyModal").addEventListener("click", (e) => {
    if (e.target.id === "apiKeyModal") closeApiKeyModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("apiKeyModal").classList.contains("is-open")) {
      closeApiKeyModal();
    }
  });
  if (!FX_API_KEY) {
    setRateStatus("点击右上⚙ 配置 API Key 以启用货币切换");
  }

  setupTargetSection();

  window.addEventListener("resize", () => {
    if (lastResult && lastInputs) drawChart(lastResult.snapshots, lastInputs);
  });

  compute();
}

setup();
