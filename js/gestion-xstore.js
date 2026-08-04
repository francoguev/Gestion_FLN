/* Gestión Xstore: módulo autónomo con soporte para PayJoy, filtro por día, nombres en registro y edición de recaudo. */
(function () {
  "use strict";

  var MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  var state = {
    profile: null, role: "", month: "", day: "", rows: [], deposits: [], pdvs: [], selectedPdvs: [],
    payjoyItems: [], reviewingId: null, editingId: null, editingKind: "", loading: false
  };

  function el(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function norm(v) { return String(v || "").trim().toLowerCase(); }
  function money(v) { return new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", minimumFractionDigits: 2 }).format(Number(v || 0)); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function isAdvisor() { return norm(state.role) === "asesor"; }
  function isOperations() { return norm(state.role) === "operaciones"; }
  function monthKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
  function monthLabel(key) { var p = key.split("-"); return MONTHS[Number(p[1]) - 1] + " " + p[0]; }
  function monthBounds(key) {
    var p = key.split("-"), y = Number(p[0]), m = Number(p[1]);
    var last = new Date(y, m, 0).getDate(), max = key + "-" + String(last).padStart(2, "0");
    return { from: key + "-01", to: max > today() ? today() : max };
  }
  function dateEs(value) { var p = String(value || "").slice(0, 10).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : "—"; }
  function setHint(text, bad) { var target = el("gxHint"); if (target) { target.textContent = text || ""; target.classList.toggle("is-error", !!bad); } }
  function setFormHint(id, text, bad) { var target = el(id); if (target) { target.textContent = text || ""; target.classList.toggle("is-error", !!bad); } }

  function selectedRows() {
    var rows = state.selectedPdvs.length ? state.rows.filter(function (r) { return state.selectedPdvs.indexOf(r.pdv) >= 0; }) : state.rows.slice();
    if (state.day) {
      rows = rows.filter(function (r) {
        var dayNum = String(r.cash_date || "").slice(8, 10);
        return dayNum === state.day;
      });
    }
    return rows;
  }

  function canRegister() { return !!(state.profile && state.profile.email); }
  function statusLabel(s) { return ({ missing_cash: "Sin registro de caja", pending_deposit: "Pendiente de depósito", deposit_review: "Depósito en revisión", validated: "Cuadrado", payjoy_validated: "Cuadrado · PayJoy", difference: "Diferencia por revisar", observed: "Observado", store_closed: "Tienda no abrió" })[s] || s; }
  function finalStatus(s) { return ["validated", "payjoy_validated", "difference", "store_closed"].indexOf(s) >= 0; }

  function populateMonths() {
    var select = el("gxMonthSelect"), now = new Date(), keys = [], i;
    if (!select) return;
    for (i = 0; i < 12; i++) keys.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    if (!state.month) state.month = keys[0];
    select.innerHTML = keys.map(function (key) { return '<option value="' + key + '"' + (key === state.month ? " selected" : "") + ">" + monthLabel(key) + "</option>"; }).join("");
    populateDays();
  }

  function populateDays() {
    var select = el("gxDaySelect");
    if (!select) return;
    var parts = state.month.split("-"), year = Number(parts[0]), month = Number(parts[1]);
    var daysInMonth = new Date(year, month, 0).getDate();
    var options = ['<option value="">Día · Todos</option>'];
    for (var d = 1; d <= daysInMonth; d++) {
      var dStr = String(d).padStart(2, "0");
      options.push('<option value="' + dStr + '"' + (dStr === state.day ? " selected" : "") + ">Día " + dStr + "</option>");
    }
    select.innerHTML = options.join("");
  }

  function availablePdvs() { return state.pdvs.length ? state.pdvs : (state.profile && state.profile.pdv ? [state.profile.pdv] : []); }
  function populatePdvInputs() {
    ["gxCashPdv", "gxDepositPdv"].forEach(function (id) {
      var select = el(id), wrap = el(id + "Wrap"), pdvs = availablePdvs();
      if (!select || !wrap) return;
      select.innerHTML = pdvs.map(function (pdv) { return '<option value="' + esc(pdv) + '">' + esc(pdv) + "</option>"; }).join("");
      if (isAdvisor()) { select.value = state.profile.pdv || ""; wrap.hidden = true; }
      else wrap.hidden = false;
    });
  }

  function currentPdv(formType) {
    var select = el(formType === "cash" ? "gxCashPdv" : "gxDepositPdv");
    return isAdvisor() ? String(state.profile.pdv || "") : String(select && select.value || "");
  }

  function renderPdvFilter() {
    var holder = el("gxPdvFilter"), button = el("gxPdvButton"), menu = el("gxPdvMenu");
    if (!holder || !button || !menu) return;
    if (isAdvisor()) { holder.hidden = true; return; }
    holder.hidden = false;
    state.selectedPdvs = state.selectedPdvs.filter(function (p) { return state.pdvs.indexOf(p) >= 0; });
    var all = state.selectedPdvs.length === 0;
    button.textContent = all ? "PDV · Todos" : "PDV · " + (state.selectedPdvs.length === 1 ? state.selectedPdvs[0] : state.selectedPdvs.length + " seleccionados");
    menu.innerHTML = '<label class="gx-pdv-all"><input type="checkbox" data-gx-pdv-all' + (all ? " checked" : "") + "> Todos los PDV</label>" + state.pdvs.map(function (pdv) {
      return '<label><input type="checkbox" data-gx-pdv="' + esc(pdv) + '"' + (state.selectedPdvs.indexOf(pdv) >= 0 ? " checked" : "") + "> " + esc(pdv) + "</label>";
    }).join("");
  }

  /* Gestor interactivo de ítems PayJoy en el formulario */
  function renderPayjoyItems() {
    var holder = el("gxPayjoyList");
    if (!holder) return;
    if (!state.payjoyItems.length) {
      holder.innerHTML = '<p class="hint" style="margin:0; font-size:12px; color:#64748b;">No se han agregado equipos PayJoy.</p>';
      recalculatePayjoyTotals();
      return;
    }
    holder.innerHTML = state.payjoyItems.map(function (item, idx) {
      return '<div class="gx-payjoy-row">' +
        '<label>Costo del equipo (Xstore)<input type="number" min="0" step="0.01" data-gx-pj-costo="' + idx + '" value="' + (item.costo || "") + '" placeholder="Ej. 100.00"></label>' +
        '<label>Inicial pagada (Efectivo)<input type="number" min="0" step="0.01" data-gx-pj-inicial="' + idx + '" value="' + (item.inicial || "") + '" placeholder="Ej. 10.00"></label>' +
        '<button type="button" class="gx-payjoy-remove" data-gx-pj-remove="' + idx + '" title="Eliminar equipo">✕</button>' +
        '</div>';
    }).join("");
    recalculatePayjoyTotals();
  }

  function recalculatePayjoyTotals() {
    var cashSystem = Number(el("gxCashAmount") ? el("gxCashAmount").value : 0) || 0;
    var payjoyPending = 0;
    state.payjoyItems.forEach(function (item) {
      var costo = Number(item.costo || 0);
      var inicial = Number(item.inicial || 0);
      var diff = costo - inicial;
      if (diff > 0) payjoyPending += diff;
    });

    var realToDeposit = Math.max(0, cashSystem - payjoyPending);

    if (el("gxCalcSystem")) el("gxCalcSystem").textContent = money(cashSystem);
    if (el("gxCalcPayjoy")) el("gxCalcPayjoy").textContent = money(payjoyPending);
    if (el("gxCalcReal")) el("gxCalcReal").textContent = money(realToDeposit);
  }

  function renderAdvisorSummary(rows) {
    var holder = el("gxSummary");
    if (!holder) return;
    holder.hidden = false;

    var missing = rows.filter(function (r) { return r.status === "missing_cash"; }).length;
    var pending = rows.reduce(function (total, r) { return total + (r.status === "pending_deposit" || r.status === "deposit_review" || r.status === "observed" ? Number(r.outstanding_amount || 0) : 0); }, 0);
    var payjoyTotal = rows.reduce(function (total, r) { return total + Number(r.payjoy_pending_amount || r.payjoy_amount || 0); }, 0);
    var review = rows.filter(function (r) { return r.status === "deposit_review"; }).length;
    var diff = rows.filter(function (r) { return r.status === "difference"; }).length;

    holder.innerHTML = '<article class="gx-summary-card is-danger"><span>Sin registro de caja</span><strong>' + missing + "</strong></article>" +
      '<article class="gx-summary-card is-alert"><span>Pendiente de depósito</span><strong>' + esc(money(pending)) + "</strong></article>" +
      '<article class="gx-summary-card" style="border-left:4px solid #f59e0b;"><span>Por cobrar PayJoy</span><strong style="color:#d97706;">' + esc(money(payjoyTotal)) + "</strong></article>" +
      '<article class="gx-summary-card"><span>Depósitos en revisión</span><strong>' + review + "</strong></article>" +
      '<article class="gx-summary-card ' + (diff ? "is-danger" : "is-good") + '"><span>Diferencias por revisar</span><strong>' + diff + "</strong></article>";
  }

  function daysText(rows) {
    if (!rows.length) return "—";
    var dates = rows.map(function (r) { return dateEs(r.cash_date); });
    return dates.length <= 4 ? dates.join(", ") : dates.slice(0, 4).join(", ") + " y " + (dates.length - 4) + " más";
  }

  var captureLoader = null;
  function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (captureLoader) return captureLoader;
    captureLoader = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
      script.onload = function () { resolve(window.html2canvas); };
      script.onerror = function () { reject(new Error("No se pudo cargar el generador de capturas.")); };
      document.head.appendChild(script);
    });
    return captureLoader;
  }

  async function copyTableCapture(holderId, fileName, button) {
    var table = document.querySelector("#" + holderId + " table");
    if (!table) { alert("Primero carga la tabla que deseas capturar."); return; }
    var original = button.textContent, stage = document.createElement("div"), copy = table.cloneNode(true);
    button.disabled = true; button.textContent = "Generando…";
    try {
      copy.querySelectorAll("th:first-child,td:first-child").forEach(function (cell) {
        cell.style.position = "static"; cell.style.boxShadow = "none";
      });
      copy.style.width = "max-content"; copy.style.minWidth = "0";
      stage.style.cssText = "position:fixed;left:-100000px;top:0;z-index:-1;background:#fff;padding:18px;width:max-content;max-width:none;";
      stage.appendChild(copy); document.body.appendChild(stage);
      var h2c = await loadHtml2Canvas();
      var canvas = await h2c(copy, { backgroundColor: "#ffffff", scale: 2, useCORS: true, logging: false, width: copy.scrollWidth, height: copy.scrollHeight });
      var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, "image/png"); });
      if (!blob) throw new Error("No se pudo crear la imagen.");
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        button.textContent = "¡Copiada!";
      } else {
        var link = document.createElement("a"); link.href = URL.createObjectURL(blob);
        link.download = fileName + ".png"; document.body.appendChild(link); link.click(); link.remove();
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 0);
        button.textContent = "Imagen descargada";
      }
    } catch (error) {
      console.error(error);
      alert("No se pudo copiar la captura. Se descargará o intenta en un navegador compatible.");
    } finally {
      if (stage.parentNode) stage.remove();
      setTimeout(function () { button.disabled = false; button.textContent = original; }, 1400);
    }
  }

  function renderPdvSummary(rows) {
    var holder = el("gxPdvSummary");
    if (!holder) return;
    if (isAdvisor()) { holder.hidden = true; holder.innerHTML = ""; return; }
    var groups = {};
    rows.forEach(function (r) { (groups[r.pdv] || (groups[r.pdv] = [])).push(r); });
    var html = Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, "es"); }).map(function (pdv) {
      var group = groups[pdv], missing = group.filter(function (r) { return r.status === "missing_cash"; }), pendingRows = group.filter(function (r) { return ["pending_deposit", "deposit_review", "observed", "difference"].indexOf(r.status) >= 0; });
      var pending = pendingRows.reduce(function (n, r) { return n + Number(r.outstanding_amount || 0); }, 0);
      return '<tr><td><strong>' + esc(pdv) + "</strong></td><td>" + group.length + " día(s)</td><td>" + esc(money(pending)) + "</td><td>" + (missing.length ? '<span class="gx-status missing_cash">' + missing.length + " sin caja</span>" : '<span class="gx-status validated">Al día</span>') + "</td><td>" + esc(daysText(pendingRows.length ? pendingRows : missing)) + "</td></tr>";
    }).join("");
    holder.hidden = false;
    holder.innerHTML = '<div class="gx-pdv-summary-head"><div><h2>Resumen por PDV</h2><p>Montos y fechas que requieren seguimiento.</p></div><button type="button" class="reset-btn gx-capture-btn" id="gxPdvSummaryCaptureBtn">Copiar captura</button></div><div class="table-scroll"><table class="gx-pdv-summary-table"><thead><tr><th>PDV</th><th>Período mostrado</th><th>Saldo por gestionar</th><th>Alerta</th><th>Días comprendidos</th></tr></thead><tbody>' + (html || '<tr><td colspan="5">No hay datos en el período.</td></tr>') + "</tbody></table></div>";
    
    var captureBtn = el("gxPdvSummaryCaptureBtn");
    if (captureBtn) {
      captureBtn.addEventListener("click", function () {
        copyTableCapture("gxPdvSummary", "resumen-por-pdv-xstore", captureBtn);
      });
    }
  }

  function syncTopScroll() {
    var table = el("gxTable");
    var topInner = el("gxTableTopScrollInner");
    if (table && topInner) {
      topInner.style.width = table.scrollWidth + "px";
    }
  }

  function depositEvidencePaths(row) {
    var paths = [];
    state.deposits.forEach(function (d) {
      (d.allocations || []).forEach(function (a) {
        if (a.closure_id === row.closure_id && d.evidence_path) {
          paths.push({ path: d.evidence_path, amount: Number(a.monto || a.allocated_amount || a.amount || 0), date: d.deposit_date });
        }
      });
    });
    return paths;
  }

  function reviewRow(row) {
    var correctionOnly = finalStatus(row.status);
    var choices = correctionOnly ? "" : '<label>Resolución<select data-gx-resolution><option value="validated">Cuadrado</option><option value="payjoy_validated">Cuadrado · PayJoy</option><option value="difference">Diferencia por revisar (Faltante/Sobrante)</option><option value="observed">Observar y devolver</option></select></label>';

    var sysCash = Number(row.cash_amount || 0);
    var pjAmount = Number(row.payjoy_pending_amount || row.payjoy_amount || 0);
    var expectedBank = Math.max(0, sysCash - pjAmount);
    var deposited = Number(row.deposit_amount || 0);
    var diff = expectedBank - deposited;
    var diffText = diff > 0
      ? ' · Faltante: <strong style="color:#b91c1c;">' + money(diff) + '</strong>'
      : (diff < 0 ? ' · Sobrante: <strong style="color:#166534;">' + money(Math.abs(diff)) + '</strong>' : ' · <strong style="color:#166534;">Cuadrado</strong>');

    var defaultNote = (diff !== 0 && !correctionOnly)
      ? "Diferencia en depósito: " + (diff > 0 ? "Faltante de " + money(diff) : "Sobrante de " + money(Math.abs(diff))) + " (Esperado: " + money(expectedBank) + ", Depositado: " + money(deposited) + ")"
      : "";

    return [
      '<tr class="gx-inline-review"><td colspan="10"><form class="gx-inline-review-card" data-gx-review-form>',
      '<input type="hidden" data-gx-review-id value="', esc(row.closure_id), '"><input type="hidden" data-gx-correction-only value="', correctionOnly ? "1" : "", '">',
      '<div class="gx-inline-review-header"><div><h3>', correctionOnly ? "Corregir recaudo" : "Conciliar", " · ", esc(row.pdv), " · ", dateEs(row.cash_date), '</h3><p>Recaudo Sistema ', money(sysCash), " · PayJoy ", money(pjAmount), " · Requerido Banco ", money(expectedBank), " · Depositado ", money(deposited), diffText, '</p></div><button type="button" class="gx-close-panel" data-gx-close-inline aria-label="Cerrar">×</button></div>',
      '<div class="gx-inline-review-fields"><label>Monto de caja correcto (Sistema)<input data-gx-correct-cash type="number" min="0" step="0.01" value="', sysCash.toFixed(2), '"></label>', choices,
      '<label style="grid-column: span 2;">Observación<input data-gx-review-note maxlength="240" placeholder="Comentario para el equipo" value="', esc(defaultNote), '"></label></div>',
      '<div class="gx-form-actions"><span data-gx-review-hint></span><button class="gx-action-btn" type="submit">', correctionOnly ? "Guardar corrección" : "Guardar validación", '</button></div></form></td></tr>'
    ].join("");
  }

  function editRow(row) {
    return [
      '<tr class="gx-inline-review gx-inline-edit"><td colspan="10"><form class="gx-inline-review-card" data-gx-edit-form>',
      '<input type="hidden" data-gx-edit-id value="', esc(row.closure_id), '">',
      '<div class="gx-inline-review-header"><div><h3>Editar recaudo · ', esc(row.pdv), ' · ', dateEs(row.cash_date), '</h3><p>Modifica el monto registrado en caja para esta fecha.</p></div><button type="button" class="gx-close-panel" data-gx-close-edit aria-label="Cerrar">×</button></div>',
      '<div class="gx-inline-review-fields"><label>Monto de recaudo correcto (Sistema)<input data-gx-edit-amount type="number" min="0" step="0.01" value="', Number(row.cash_amount || 0).toFixed(2), '"></label><label>Observación<input data-gx-edit-note maxlength="240" placeholder="Motivo de la corrección"></label></div>',
      '<div class="gx-form-actions"><span data-gx-edit-hint></span><button class="gx-action-btn" type="submit">Guardar recaudo</button></div></form></td></tr>'
    ].join("");
  }

  function renderTable() {
    var body = el("gxTbody"); if (!body) return;
    var rows = selectedRows(); renderAdvisorSummary(rows); renderPdvSummary(rows);
    if (!rows.length) { body.innerHTML = '<tr><td colspan="10" class="gx-empty">No hay cierres para el período seleccionado.</td></tr>'; return; }

    body.innerHTML = rows.map(function (row) {
      var actions = [], vouchers = depositEvidencePaths(row);
      if (row.evidence_path) actions.push('<button type="button" class="gx-row-btn" data-gx-evidence="' + esc(row.evidence_path) + '">Foto de caja</button>');
      if (vouchers.length === 1) {
        actions.push('<button type="button" class="gx-row-btn" data-gx-evidence="' + esc(vouchers[0].path) + '">Foto de voucher</button>');
      } else if (vouchers.length > 1) {
        actions.push('<button type="button" class="gx-row-btn" data-gx-multi-vouchers="' + row.closure_id + '">Fotos de voucher (' + vouchers.length + ')</button>');
      }

      /* Regla de Edición: Siempre permite "Editar recaudo" por día mientras no esté validado de forma final. */
      if (row.closure_id && !row.store_closed && !row.review_started_at && !finalStatus(row.status)) {
        actions.push('<button type="button" class="gx-row-btn" data-gx-edit-cash="' + row.closure_id + '">Editar recaudo</button>');
      }

      /* Regla de Conciliación para Operaciones:
         Solo se muestra si hay un depósito subido (deposit_review, observed, difference) O si el recaudo es cero / tienda no abrió. */
      var canConciliate = isOperations() && row.closure_id && !finalStatus(row.status) && (
        row.status === "deposit_review" ||
        row.status === "observed" ||
        row.status === "difference" ||
        Number(row.cash_amount || 0) === 0 ||
        row.store_closed
      );

      if (canConciliate) {
        actions.push('<button type="button" class="gx-row-btn gx-resolve-btn" data-gx-resolve="' + row.closure_id + '">Conciliar</button>');
      }

      if (isOperations() && row.closure_id && !finalStatus(row.status)) {
        actions.push('<button type="button" class="gx-row-btn is-danger" data-gx-delete="' + row.closure_id + '">Eliminar</button>');
      }

      /* Nombres del Usuario en Registro estructurados con espacio holgado */
      var regName = row.registered_by_name || row.registered_by_email || "";
      var updName = row.updated_by_name || row.updated_by_email || "";
      var traceHtml = '<span style="color:#94a3b8; font-style:italic;">Sin declaración</span>';
      if (regName) {
        traceHtml = '<div class="gx-user-info">' +
          '<div class="gx-user-item"><span class="gx-user-tag">Caja</span><span class="gx-user-name">' + esc(regName) + '</span></div>' +
          (updName && updName !== regName ? '<div class="gx-user-item"><span class="gx-user-tag is-act">Act.</span><span class="gx-user-name">' + esc(updName) + '</span></div>' : '') +
          '</div>';
      }

      var pjPending = Number(row.payjoy_pending_amount || row.payjoy_amount || 0);
      var realCash = row.closure_id ? Math.max(0, Number(row.cash_amount || 0) - pjPending) : 0;
      var deposited = Number(row.deposit_amount || 0);
      var surplus = row.closure_id ? Math.max(0, deposited - realCash) : 0;
      var outstanding = row.closure_id ? Math.max(0, realCash - deposited) : 0;

      var bankStatusHtml = "—";
      if (row.closure_id) {
        if (surplus > 0) {
          bankStatusHtml = '<span style="color:#166534; font-weight:700;">+ ' + money(surplus) + ' Sobrante</span>';
        } else {
          bankStatusHtml = money(outstanding);
        }
      }

      var pjHtml = pjPending > 0 ? money(pjPending) + ' <span class="gx-payjoy-badge">PayJoy</span>' : (row.closure_id ? "S/ 0.00" : "—");

      /* Menú Desplegable "Acciones ▾" */
      var actionsHtml = "—";
      if (actions.length > 0) {
        actionsHtml = '<div class="gx-dropdown">' +
          '<button type="button" class="gx-dropdown-toggle" onclick="gxToggleActionMenu(event, this)">Acciones ▾</button>' +
          '<div class="gx-dropdown-menu">' + actions.join("") + '</div>' +
          '</div>';
      }

      var line = "<tr>" +
        "<td>" + dateEs(row.cash_date) + "</td>" +
        "<td>" + esc(row.pdv) + "</td>" +
        '<td class="gx-money">' + (row.closure_id ? money(row.cash_amount) : "—") + "</td>" +
        '<td>' + pjHtml + "</td>" +
        '<td class="gx-money" style="font-weight:700; color:#1d4ed8;">' + (row.closure_id ? money(realCash) : "—") + "</td>" +
        '<td class="gx-money">' + (row.closure_id ? money(row.deposit_amount) : "—") + "</td>" +
        '<td class="gx-money">' + bankStatusHtml + "</td>" +
        '<td><span class="gx-status ' + esc(row.status) + '">' + esc(statusLabel(row.status)) + '</span></td>' +
        '<td class="gx-user-cell">' + traceHtml + "</td>" +
        '<td class="gx-actions-cell">' + actionsHtml + "</td>" +
        "</tr>";

      return line +
        (state.reviewingId && row.closure_id && state.reviewingId === row.closure_id ? reviewRow(row) : "") +
        (state.editingId && row.closure_id && state.editingId === row.closure_id ? editRow(row) : "");
    }).join("");
    syncTopScroll();
  }

  async function loadData() {
    if (state.loading || !state.profile || !window.supabaseClient) return;
    state.loading = true; setHint("Cargando registros…");
    try {
      var range = monthBounds(state.month), results = await Promise.all([
        window.supabaseClient.rpc("xstore_dashboard_rows", { p_from: range.from, p_to: range.to }),
        window.supabaseClient.rpc("xstore_monthly_deposits", { p_from: range.from, p_to: range.to })
      ]);
      if (results[0].error) throw results[0].error;
      if (results[1].error) throw results[1].error;
      state.rows = results[0].data || []; state.deposits = results[1].data || [];
      state.pdvs = Array.from(new Set(state.rows.map(function (r) { return r.pdv; }))).sort(function (a, b) { return a.localeCompare(b, "es"); });
      renderPdvFilter(); populatePdvInputs(); renderTable(); populateAllocationList();
      setHint(state.rows.length + " cierre(s) esperado(s) · " + monthLabel(state.month));
    } catch (error) {
      console.error("Gestión Xstore:", error); state.rows = []; state.deposits = []; renderTable(); setHint("No se pudo cargar Gestión Xstore. Comprueba la conexión o ejecuta el SQL 010.", true);
    } finally { state.loading = false; }
  }

  function panel(name, show) { var target = el(name === "cash" ? "gxCashPanel" : "gxDepositPanel"); if (target) target.hidden = !show; }
  function openPanel(name) {
    panel("cash", false); panel("deposit", false); panel(name, true);
    if (name === "cash") {
      el("gxCashDate").value = today();
      state.payjoyItems = [];
      renderPayjoyItems();
      syncClosedFields();
    } else {
      el("gxDepositDate").value = today();
      populateAllocationList();
    }
  }

  function syncClosedFields() {
    var closed = el("gxStoreClosed").checked, amount = el("gxCashAmount"), file = el("gxCashFile"), pjSec = el("gxPayjoySection");
    amount.disabled = closed;
    if (closed) amount.value = "0";
    file.required = !closed;
    el("gxStoreClosedReasonWrap").hidden = !closed;
    if (pjSec) pjSec.style.display = closed ? "none" : "block";
    recalculatePayjoyTotals();
  }

  function eligibleForDeposit(row, pdv) { return row.closure_id && row.pdv === pdv && !row.store_closed && !row.review_started_at && !finalStatus(row.status) && Number(row.outstanding_amount || 0) >= 0; }
  function populateAllocationList() {
    var holder = el("gxAllocationList"), pdv = currentPdv("deposit"); if (!holder) return;
    var candidates = state.rows.filter(function (r) { return eligibleForDeposit(r, pdv); });
    holder.innerHTML = candidates.length ? candidates.map(function (r) {
      var maxVal = Number(r.outstanding_amount || 0);
      return '<label class="gx-allocation-row"><input type="checkbox" data-gx-allocation="' + r.closure_id + '" data-gx-max="' + maxVal + '"><span>' + dateEs(r.cash_date) + " · Requerido Banco " + money(maxVal) + '</span><input type="number" min="0.01" step="0.01" placeholder="' + maxVal.toFixed(2) + '" data-gx-allocation-amount="' + r.closure_id + '" disabled></label>';
    }).join("") : '<span class="hint">No hay días pendientes para este PDV.</span>';
  }
  function refreshDepositTotal() { var total = 0; document.querySelectorAll("[data-gx-allocation-amount]").forEach(function (input) { if (!input.disabled) total += Number(input.value || 0); }); el("gxDepositAmount").value = total ? total.toFixed(2) : ""; }

  async function compressImage(file) {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Adjunta una imagen JPG, PNG o WebP.");
    var image = await new Promise(function (resolve, reject) { var reader = new FileReader(); reader.onload = function () { var img = new Image(); img.onload = function () { resolve(img); }; img.onerror = reject; img.src = reader.result; }; reader.onerror = reject; reader.readAsDataURL(file); });
    var scale = Math.min(1, 1600 / Math.max(image.width, image.height)), canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale)); canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, "image/webp", 0.74); });
    if (!blob || blob.size > 1500000) throw new Error("La imagen es demasiado pesada. Usa una foto más cercana.");
    return blob;
  }
  function pdvKey(pdv) { return String(pdv || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
  async function uploadEvidence(file, kind, pdv) { var blob = await compressImage(file), path = "pdv/" + pdvKey(pdv) + "/" + kind + "-" + Date.now() + "-" + crypto.randomUUID() + ".webp"; var upload = await window.supabaseClient.storage.from("xstore-evidencias").upload(path, blob, { contentType: "image/webp", upsert: false }); if (upload.error) throw upload.error; return path; }

  async function submitCash(event) {
    event.preventDefault();
    var pdv = currentPdv("cash"), closed = el("gxStoreClosed").checked, amount = Number(el("gxCashAmount").value || 0), file = el("gxCashFile").files[0];
    try {
      if (!pdv) throw new Error("Selecciona un PDV."); setFormHint("gxCashFormHint", "Guardando…");
      var path = closed ? "" : await uploadEvidence(file, "caja", pdv);
      var result = await window.supabaseClient.rpc("xstore_submit_cash", {
        p_pdv: pdv, p_cash_date: el("gxCashDate").value, p_cash_amount: closed ? 0 : amount,
        p_evidence_path: path, p_store_closed: closed, p_store_closed_reason: el("gxStoreClosedReason").value,
        p_payjoy_items: state.payjoyItems
      });
      if (result.error) throw result.error;
      event.target.reset();
      state.payjoyItems = [];
      panel("cash", false);
      await loadData();
    } catch (error) { setFormHint("gxCashFormHint", error.message || "No se pudo guardar el recaudo.", true); }
  }

  async function submitDeposit(event) {
    event.preventDefault(); var pdv = currentPdv("deposit"), allocations = [];
    document.querySelectorAll("[data-gx-allocation]:checked").forEach(function (check) { var id = check.getAttribute("data-gx-allocation"), input = document.querySelector('[data-gx-allocation-amount="' + CSS.escape(id) + '"]'); allocations.push({ closure_id: id, amount: Number(input.value || 0) }); });
    try {
      if (!pdv || !allocations.length) throw new Error("Selecciona un PDV y al menos un día de caja."); setFormHint("gxDepositFormHint", "Subiendo voucher…");
      var amount = Number(el("gxDepositAmount").value || 0), path = await uploadEvidence(el("gxDepositFile").files[0], "deposito", pdv);
      var result = await window.supabaseClient.rpc("xstore_submit_deposit", { p_pdv: pdv, p_deposit_date: el("gxDepositDate").value, p_deposit_amount: amount, p_evidence_path: path, p_allocations: allocations });
      if (result.error) throw result.error; event.target.reset(); panel("deposit", false); await loadData();
    } catch (error) { setFormHint("gxDepositFormHint", error.message || "No se pudo guardar el depósito.", true); }
  }

  function togglePayjoy(form) { form.querySelector("[data-gx-payjoy-wrap]").hidden = form.querySelector("[data-gx-resolution]").value !== "payjoy_validated"; }

  async function beginReview(id) {
    var row = state.rows.find(function (item) { return item.closure_id === id; });
    if (!row) return;
    try {
      if (!finalStatus(row.status)) {
        var start = await window.supabaseClient.rpc("xstore_start_review", { p_closure_id: id });
        if (start.error) throw start.error;
      }
      state.editingId = null; state.reviewingId = id;
      await loadData();
    } catch (error) { setHint(error.message || "No se pudo iniciar la conciliación.", true); }
  }

  async function closeReview() {
    var id = state.reviewingId, row = state.rows.find(function (item) { return item.closure_id === id; });
    try {
      if (id && row && !finalStatus(row.status)) {
        var release = await window.supabaseClient.rpc("xstore_release_review", { p_closure_id: id });
        if (release.error) throw release.error;
      }
      state.reviewingId = null;
      await loadData();
    } catch (error) { setHint(error.message || "No se pudo cerrar la conciliación.", true); }
  }

  function beginEdit(id) {
    var row = state.rows.find(function (item) { return item.closure_id === id; });
    if (!row) return;
    state.reviewingId = null;
    state.editingId = id;
    renderTable();
  }

  function closeEdit() {
    state.editingId = null;
    renderTable();
  }

  async function submitEdit(event) {
    event.preventDefault();
    var form = event.target, id = form.querySelector("[data-gx-edit-id]").value,
      amount = Number(form.querySelector("[data-gx-edit-amount]").value || 0), note = form.querySelector("[data-gx-edit-note]").value,
      hint = form.querySelector("[data-gx-edit-hint]");
    try {
      if (amount < 0) throw new Error("El monto no es válido.");
      var result = await window.supabaseClient.rpc("xstore_correct_cash_amount", { p_closure_id: id, p_cash_amount: amount, p_note: note });
      if (result.error) throw result.error;
      state.editingId = null;
      await loadData();
    } catch (error) { hint.textContent = error.message || "No se pudo guardar la corrección."; hint.classList.add("is-error"); }
  }

  async function submitReview(event) {
    event.preventDefault(); var form = event.target, id = form.querySelector("[data-gx-review-id]").value, hint = form.querySelector("[data-gx-review-hint]");
    try {
      var row = state.rows.find(function (r) { return r.closure_id === id; }), amount = Number(form.querySelector("[data-gx-correct-cash]").value || 0), note = form.querySelector("[data-gx-review-note]").value;
      if (!row || amount < 0) throw new Error("El monto de caja no es válido.");
      if (Math.abs(amount - Number(row.cash_amount || 0)) > 0.004) { var correction = await window.supabaseClient.rpc("xstore_correct_cash_amount", { p_closure_id: id, p_cash_amount: amount, p_note: note }); if (correction.error) throw correction.error; }
      var pjVal = Number(row.payjoy_pending_amount || row.payjoy_amount || 0);
      var result = await window.supabaseClient.rpc("xstore_resolve_closure", { p_closure_id: id, p_resolution: form.querySelector("[data-gx-resolution]").value, p_payjoy_amount: pjVal, p_note: note });
      if (result.error) throw result.error; state.reviewingId = null; await loadData();
    } catch (error) { hint.textContent = error.message || "No se pudo guardar la validación."; hint.classList.add("is-error"); }
  }

  async function deleteClosure(id) {
    var row = state.rows.find(function (r) { return r.closure_id === id; });
    if (!row) return;
    var confirmMsg = "¿Estás seguro de eliminar por completo el registro de recaudo de " + row.pdv + " del " + dateEs(row.cash_date) + "?\n\nEsta acción eliminará la caja y cualquier depósito asignado. No se puede deshacer.";
    if (!window.confirm(confirmMsg)) return;
    try {
      setHint("Eliminando registro…");
      var result = await window.supabaseClient.rpc("xstore_delete_closure", { p_closure_id: id });
      if (result.error) throw result.error;
      state.reviewingId = null; state.editingId = null;
      await loadData();
    } catch (error) {
      alert(error.message || "No se pudo eliminar el registro.");
      setHint("Error al eliminar el registro.", true);
    }
  }

  async function openEvidence(path) { try { var result = await window.supabaseClient.storage.from("xstore-evidencias").createSignedUrl(path, 120); if (result.error) throw result.error; window.open(result.data.signedUrl, "_blank", "noopener"); } catch (_) { alert("No se pudo abrir la evidencia."); } }
  function exportExcel() { if (!isOperations()) return; var rows = selectedRows(); var html = '<table><tr><th>Fecha</th><th>PDV</th><th>Recaudo Sistema</th><th>PayJoy Por Cobrar</th><th>Efectivo a Depositar</th><th>Depositado</th><th>Pendiente Banco</th><th>Estado</th><th>Registrado por</th></tr>' + rows.map(function (r) { var pj = Number(r.payjoy_pending_amount || r.payjoy_amount || 0); var real = Math.max(0, Number(r.cash_amount || 0) - pj); return "<tr><td>" + dateEs(r.cash_date) + "</td><td>" + esc(r.pdv) + "</td><td>" + Number(r.cash_amount || 0) + "</td><td>" + pj + "</td><td>" + real + "</td><td>" + Number(r.deposit_amount || 0) + "</td><td>" + Number(r.outstanding_amount || 0) + "</td><td>" + esc(statusLabel(r.status)) + "</td><td>" + esc(r.registered_by_name || r.registered_by_email || "") + "</td></tr>"; }).join("") + "</table>"; var blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" }), link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "gestion-xstore-" + state.month + ".xls"; link.click(); URL.revokeObjectURL(link.href); }

  window.loadGestionXstore = async function () { state.profile = window.currentUserProfile; if (!canRegister()) { setHint("No se pudo identificar tu usuario.", true); return; } state.role = state.profile.cargo || ""; populateMonths(); var actions = el("gxEntryActions"), exportBtn = el("gxExportBtn"); if (actions) actions.hidden = false; if (exportBtn) exportBtn.hidden = !isOperations(); await loadData(); };

  document.addEventListener("DOMContentLoaded", function () {
    var month = el("gxMonthSelect"), day = el("gxDaySelect"), refresh = el("gxRefreshBtn"), cashForm = el("gxCashForm"), depositForm = el("gxDepositForm"), pdvMenu = el("gxPdvMenu"), pdvButton = el("gxPdvButton");
    if (!month || !cashForm || !depositForm) return;

    month.addEventListener("change", function () { state.month = month.value; state.day = ""; populateDays(); loadData(); });
    if (day) { day.addEventListener("change", function () { state.day = day.value; renderTable(); }); }

    refresh.addEventListener("click", loadData);
    if (el("gxExportBtn")) el("gxExportBtn").addEventListener("click", exportExcel);

    document.querySelectorAll("[data-gx-open]").forEach(function (b) { b.addEventListener("click", function () { openPanel(b.getAttribute("data-gx-open")); }); });
    document.querySelectorAll("[data-gx-close]").forEach(function (b) { b.addEventListener("click", function () { panel(b.getAttribute("data-gx-close"), false); }); });

    el("gxStoreClosed").addEventListener("change", syncClosedFields);
    el("gxCashAmount").addEventListener("input", recalculatePayjoyTotals);

    /* Eventos dinámicos para agregar/quitar equipos PayJoy */
    if (el("gxAddPayjoyBtn")) {
      el("gxAddPayjoyBtn").addEventListener("click", function () {
        state.payjoyItems.push({ costo: "", inicial: "" });
        renderPayjoyItems();
      });
    }

    if (el("gxPayjoyList")) {
      el("gxPayjoyList").addEventListener("input", function (event) {
        var costInput = event.target.closest("[data-gx-pj-costo]");
        var initInput = event.target.closest("[data-gx-pj-inicial]");
        if (costInput) {
          var idx = Number(costInput.getAttribute("data-gx-pj-costo"));
          state.payjoyItems[idx].costo = costInput.value;
          recalculatePayjoyTotals();
        }
        if (initInput) {
          var idx = Number(initInput.getAttribute("data-gx-pj-inicial"));
          state.payjoyItems[idx].inicial = initInput.value;
          recalculatePayjoyTotals();
        }
      });

      el("gxPayjoyList").addEventListener("click", function (event) {
        var removeBtn = event.target.closest("[data-gx-pj-remove]");
        if (removeBtn) {
          var idx = Number(removeBtn.getAttribute("data-gx-pj-remove"));
          state.payjoyItems.splice(idx, 1);
          renderPayjoyItems();
        }
      });
    }

    cashForm.addEventListener("submit", submitCash);
    depositForm.addEventListener("submit", submitDeposit);
    el("gxDepositPdv").addEventListener("change", populateAllocationList);

    el("gxAllocationList").addEventListener("change", function (event) { var check = event.target.closest("[data-gx-allocation]"); if (!check) return; var input = document.querySelector('[data-gx-allocation-amount="' + CSS.escape(check.getAttribute("data-gx-allocation")) + '"]'); input.disabled = !check.checked; input.value = check.checked ? Number(check.getAttribute("data-gx-max")).toFixed(2) : ""; refreshDepositTotal(); });
    el("gxAllocationList").addEventListener("input", refreshDepositTotal);

    document.addEventListener("submit", function (event) { if (event.target.matches("[data-gx-review-form]")) submitReview(event); });
    document.addEventListener("submit", function (event) { if (event.target.matches("[data-gx-edit-form]")) submitEdit(event); });
    document.addEventListener("change", function (event) { var form = event.target.closest("[data-gx-review-form]"); if (form && event.target.matches("[data-gx-resolution]")) togglePayjoy(form); });

    pdvButton.addEventListener("click", function () { var open = pdvMenu.hidden; pdvMenu.hidden = !open; pdvButton.setAttribute("aria-expanded", String(open)); });
    pdvMenu.addEventListener("change", function (event) { var all = pdvMenu.querySelector("[data-gx-pdv-all]"), checks = Array.prototype.slice.call(pdvMenu.querySelectorAll("[data-gx-pdv]")); if (event.target.matches("[data-gx-pdv-all]")) { state.selectedPdvs = []; } else { if (all) all.checked = false; state.selectedPdvs = checks.filter(function (c) { return c.checked; }).map(function (c) { return c.getAttribute("data-gx-pdv"); }); } renderPdvFilter(); renderTable(); });
    document.addEventListener("click", function (event) { if (!event.target.closest("#gxPdvFilter")) { pdvMenu.hidden = true; pdvButton.setAttribute("aria-expanded", "false"); } });

  async function openMultiVouchers(closureId) {
    var row = state.rows.find(function (r) { return r.closure_id === closureId; });
    if (!row) return;
    var vouchers = depositEvidencePaths(row);
    if (!vouchers.length) return;
    try {
      for (var i = 0; i < vouchers.length; i++) {
        var res = await window.supabaseClient.storage.from("xstore-evidencias").createSignedUrl(vouchers[i].path, 120);
        if (res.data && res.data.signedUrl) {
          window.open(res.data.signedUrl, "_blank", "noopener");
        }
      }
    } catch (_) {
      alert("No se pudieron abrir las evidencias de depósito.");
    }
  }

  window.gxToggleActionMenu = function(event, btn) {
    event.stopPropagation();
    var dropdown = btn.closest('.gx-dropdown');
    if (!dropdown) return;
    var isOpen = dropdown.classList.contains('is-open');
    document.querySelectorAll('.gx-dropdown.is-open').forEach(function(d) { d.classList.remove('is-open'); });
    if (!isOpen) {
      dropdown.classList.add('is-open');
    }
  };

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.gx-dropdown')) {
      document.querySelectorAll('.gx-dropdown.is-open').forEach(function(d) { d.classList.remove('is-open'); });
    }
  });

  el("gxTbody").addEventListener("click", function (event) {
    var evidence = event.target.closest("[data-gx-evidence]"), resolve = event.target.closest("[data-gx-resolve]"), close = event.target.closest("[data-gx-close-inline]"), closeEditButton = event.target.closest("[data-gx-close-edit]"), editCash = event.target.closest("[data-gx-edit-cash]"), deleteBtn = event.target.closest("[data-gx-delete]"), multiVouchers = event.target.closest("[data-gx-multi-vouchers]");
    if (evidence) openEvidence(evidence.getAttribute("data-gx-evidence"));
    if (multiVouchers) openMultiVouchers(multiVouchers.getAttribute("data-gx-multi-vouchers"));
    if (resolve) beginReview(resolve.getAttribute("data-gx-resolve"));
    if (editCash) beginEdit(editCash.getAttribute("data-gx-edit-cash"));
    if (deleteBtn) deleteClosure(deleteBtn.getAttribute("data-gx-delete"));
    if (close) closeReview();
    if (closeEditButton) closeEdit();
  });

  var topScroll = el("gxTableTopScroll");
  var tableScroll = el("gxTableScroll");
  if (topScroll && tableScroll) {
    var isSyncingTop = false;
    var isSyncingTable = false;

    topScroll.addEventListener("scroll", function () {
      if (!isSyncingTable) {
        isSyncingTop = true;
        tableScroll.scrollLeft = topScroll.scrollLeft;
      }
      isSyncingTable = false;
    });

    tableScroll.addEventListener("scroll", function () {
      if (!isSyncingTop) {
        isSyncingTable = true;
        topScroll.scrollLeft = tableScroll.scrollLeft;
      }
      isSyncingTop = false;
    });

    window.addEventListener("resize", syncTopScroll);
  }
});
}());
