(function () {
  "use strict";

  var FALTANTES_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ5jEBH9aFLKg49xu7TDUkA--s1M74rgK1sOQl_m6t_0hP75zzOSfxdLc4yoaFgeTyl33t20etYOwwq/pub?gid=1521970412&single=true&output=csv";

  var stockItems = [];
  var stockLoadedAt = 0;
  var STOCK_CACHE_MS = 60 * 1000; // 1 minuto
  var stockDefaultPuntoApplied = false;
  var pendingUploadPayload = null;

  var MONTH_MAP = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
    ENE: "01", FEB: "02", MAR: "03", ABR: "04", MAY: "05", JUN: "06",
    JUL: "07", AGO: "08", SET: "09", SEP: "09", OCT: "10", NOV: "11", DIC: "12"
  };

  function norm(s) {
    return (s || "").toString().trim().toUpperCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function esc(s) {
    return (s || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function formatDateEs(dateStr) {
    if (!dateStr) return "—";
    var p = String(dateStr).slice(0, 10).split("-");
    return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : dateStr;
  }

  function parseDateIso(raw) {
    if (!raw) return null;
    var str = String(raw).trim();
    if (!str) return null;

    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

    // DD/MM/YYYY o DD-MM-YYYY
    var partsSlash = str.split(/[\/\-\.]/);
    if (partsSlash.length === 3) {
      var d = partsSlash[0].padStart(2, "0");
      var m = partsSlash[1].toUpperCase();
      var y = partsSlash[2];

      if (y.length === 2) y = "20" + y;

      if (MONTH_MAP[m]) {
        m = MONTH_MAP[m];
      } else {
        m = m.padStart(2, "0");
      }

      if (/^\d{4}$/.test(y) && /^\d{2}$/.test(m) && /^\d{2}$/.test(d)) {
        return y + "-" + m + "-" + d;
      }

      // Si venía YYYY/MM/DD
      if (/^\d{4}$/.test(partsSlash[0]) && /^\d{2}$/.test(partsSlash[1]) && /^\d{2}$/.test(partsSlash[2])) {
        return partsSlash[0] + "-" + partsSlash[1] + "-" + partsSlash[2];
      }
    }
    return null;
  }

  function calculatePreviousDateIso(dateObj) {
    var d = new Date(dateObj || new Date());
    d.setDate(d.getDate() - 1);
    var year = d.getFullYear();
    var month = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function deriveMarca(sku, desc) {
    var s = norm(sku), d = norm(desc);
    if (s.indexOf("APLI") === 0 || d.indexOf("APPLE") !== -1 || d.indexOf("IPHONE") !== -1) return "APPLE";
    if (s.indexOf("SGLX") === 0 || s.indexOf("SGX") === 0 || d.indexOf("SAMSUNG") !== -1 || d.indexOf("GALAXY") !== -1) return "SAMSUNG";
    if (s.indexOf("HONO") === 0 || s.indexOf("PKHO") === 0 || d.indexOf("HONOR") !== -1) return "HONOR";
    if (s.indexOf("MOTO") === 0 || d.indexOf("MOTOROLA") !== -1) return "MOTOROLA";
    if (s.indexOf("XIAR") === 0 || d.indexOf("XIAOMI") !== -1 || d.indexOf("REDMI") !== -1) return "XIAOMI";
    if (s.indexOf("ZTEB") === 0 || d.indexOf("ZTE") !== -1) return "ZTE";
    if (s.indexOf("CHIP") === 0 || s.indexOf("SUPE") === 0 || d.indexOf("ENTEL") !== -1) return "ENTEL";
    return "GENERAL";
  }

  function deriveTipo(sku, desc) {
    var s = norm(sku), d = norm(desc);
    if (s.indexOf("CHIP") === 0 || s.indexOf("SUPERCHIP") === 0 || d.indexOf("CHIP") === 0 || d.indexOf("SUPER CHIP") === 0 || d.indexOf("SUPERCHIP") === 0) return "CHIP";
    if (s.indexOf("ACC") === 0 || s.indexOf("AUD") === 0 || s.indexOf("CARG") === 0 || s.indexOf("FUND") === 0 || d.indexOf("ACCESORIO") === 0 || d.indexOf("AUDIFONO") === 0 || d.indexOf("CARGADOR") === 0) return "ACCESORIO";
    return "EQUIPO";
  }

  function normalizeTex(pdvRaw, org) {
    var rawStr = (org || pdvRaw || "").toUpperCase();
    if (rawStr.indexOf("CANETE") !== -1 || rawStr.indexOf("CAÑETE") !== -1 || rawStr.indexOf("CA?ETE") !== -1 || rawStr.indexOf("LIMCA") !== -1) return "TE SATELITE CAÑETE";
    var text = norm(org || pdvRaw || "");
    if (text.indexOf("NAZCA") !== -1) return "TE NAZCA";
    if (text.indexOf("PARCONA") !== -1) return "TE PARCONA";
    if (text.indexOf("AYACUCHO") !== -1) return "TE AYACUCHO";
    if (text.indexOf("HUANTA") !== -1) return "TE HUANTA";
    if (text.indexOf("PISCO") !== -1) return "TE PISCO";
    if (text.indexOf("ICA 3") !== -1 || text.indexOf("ICA3") !== -1) return "TE ICA 3";
    if (text.indexOf("ICA II") !== -1 || text.indexOf("ICAII") !== -1) return "TE ICA II";
    if (text.indexOf("MODELO") !== -1) return "TE ICA MODELO";
    if (text.indexOf("BARRIO CHINO") !== -1) return "TE SATELITE BARRIO CHINO";
    if (text.indexOf("CHALA") !== -1) return "TE SATELITE CHALA";
    if (text.indexOf("CANETE") !== -1 || text.indexOf("CAÑETE") !== -1 || text.indexOf("CA?ETE") !== -1 || text.indexOf("LIMCA") !== -1) return "TE SATELITE CAÑETE";
    if (text.indexOf("PUEBLO JOVEN") !== -1 || text.indexOf("PUEJOVEN") !== -1) return "TE SATELITE PUEBLO JOVEN";
    if (text.indexOf("PALPA") !== -1) return "TE SATELITE PALPA";
    if (text.indexOf("ICA") !== -1) return "TE ICA";

    // Fallback limpio
    var clean = (org || pdvRaw || "").replace(/^\d+\.\s*/, "").replace(/^TEXPRESS\s*/i, "TE ").replace(/\?/g, "Ñ").trim();
    return clean || "TE GENERAL";
  }

  async function fetchFaltantesSet() {
    var set = new Set();
    try {
      var res = await fetch(FALTANTES_CSV_URL + "&_=" + Date.now());
      if (!res.ok) return set;
      var text = await res.text();
      var lines = text.split("\n");
      for (var i = 1; i < lines.length; i++) {
        var cols = lines[i].split(",");
        var imei = cols[1] ? cols[1].replace(/["'\s]/g, "") : "";
        if (imei && imei.length > 5) set.add(norm(imei));
      }
    } catch (_) { }
    return set;
  }

  function isAdminOrOps() {
    var p = window.currentUserProfile;
    return !!(p && (p.es_administrador || norm(p.cargo) === "OPERACIONES" || norm(p.cargo) === "ADMINISTRADOR"));
  }

  function checkAdminUploadVisibility() {
    var wrap = document.getElementById("stockAdminUploadWrap");
    if (wrap) wrap.style.display = isAdminOrOps() ? "inline-flex" : "none";
  }

  function populateFilters() {
    var puntoSelect = document.getElementById("stockFilterPunto");
    var marcaSelect = document.getElementById("stockFilterMarca");
    var tipoSelect = document.getElementById("stockFilterTipo");

    var puntosSet = {}, marcasSet = {}, tiposSet = {};
    stockItems.forEach(function (it) {
      if (it.tex_normalizado) puntosSet[it.tex_normalizado] = true;
      if (it.marca) marcasSet[it.marca] = true;
      if (it.tipo) tiposSet[it.tipo] = true;
    });

    var puntos = Object.keys(puntosSet).sort();
    var marcas = Object.keys(marcasSet).sort();
    var tipos = Object.keys(tiposSet).sort();

    puntoSelect.innerHTML = '<option value="">PUNTO DE VENTA · Todo</option>' +
      puntos.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join("");
    marcaSelect.innerHTML = '<option value="">MARCA · Todo</option>' +
      marcas.map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + '</option>'; }).join("");

    if (tipos.length) {
      tipoSelect.innerHTML = '<option value="">TIPO · Todo</option>' +
        tipos.map(function (t) {
          return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
        }).join("");
      tipoSelect.value = "";
    } else {
      tipoSelect.innerHTML = '<option value="">TIPO · Todo</option>';
    }
  }

  function renderStockSummary() {
    var filtroPunto = document.getElementById("stockFilterPunto").value;
    var filtroMarca = document.getElementById("stockFilterMarca").value;
    var filtroEstado = document.getElementById("stockFilterEstado").value;

    var chipGroups = {};
    var equipoGroups = {};

    stockItems.forEach(function (it) {
      if (filtroEstado && it.estado_stock !== filtroEstado) return;
      if (filtroPunto && it.tex_normalizado !== filtroPunto) return;
      if (filtroMarca && it.marca !== filtroMarca) return;

      var tipoNorm = norm(it.tipo || "");
      var sku = it.sku || "SIN SKU";
      if (tipoNorm === "CHIP") {
        chipGroups[sku] = (chipGroups[sku] || 0) + 1;
      } else if (tipoNorm === "EQUIPO") {
        equipoGroups[sku] = (equipoGroups[sku] || 0) + 1;
      }
    });

    renderStockPills("stockChipBody", "stockChipTotal", chipGroups);
    renderStockPills("stockEquipoBody", "stockEquipoTotal", equipoGroups);
  }

  function renderStockPills(bodyId, totalId, groups) {
    var body = document.getElementById(bodyId);
    var skus = Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, "es"); });

    var total = 0;
    skus.forEach(function (sku) { total += groups[sku]; });
    var totalEl = document.getElementById(totalId);
    if (totalEl) totalEl.textContent = "- " + total;

    if (!skus.length) {
      body.innerHTML = '<div class="stock-pill-empty">Sin datos con este filtro.</div>';
      return;
    }
    body.innerHTML = skus.map(function (sku) {
      return '<div class="stock-pill"><span class="stock-pill-sku">' + esc(sku) + '</span>' +
        '<span class="stock-pill-qty">' + groups[sku] + '</span></div>';
    }).join("");
  }

  function brandBadge(marca) {
    var m = (marca || "").toUpperCase().trim();
    var cls = "stock-brand-tag";
    if (m.indexOf("SAMSUNG") !== -1) cls += " is-samsung";
    else if (m.indexOf("HONOR") !== -1) cls += " is-honor";
    else if (m.indexOf("APPLE") !== -1 || m.indexOf("IPHONE") !== -1) cls += " is-apple";
    else if (m.indexOf("XIAOMI") !== -1 || m.indexOf("REDMI") !== -1) cls += " is-xiaomi";
    else if (m.indexOf("MOTOROLA") !== -1 || m.indexOf("MOTO") !== -1) cls += " is-motorola";
    else if (m.indexOf("ZTE") !== -1) cls += " is-zte";
    else cls += " is-default";
    return '<span class="' + cls + '">' + esc(m || "GENERAL") + '</span>';
  }

  function statusBadge(estado) {
    var st = norm(estado || "DISPONIBLE");
    if (st === "VENDIDO") return '<span class="gx-user-tag" style="background:#fee2e2; color:#991b1b; border:1px solid #fca5a5;">VENDIDO</span>';
    if (st === "FALTANTE") return '<span class="gx-user-tag" style="background:#fef3c7; color:#92400e; border:1px solid #fcd34d;">FALTANTE</span>';
    return '<span class="gx-user-tag" style="background:#dcfce7; color:#166534; border:1px solid #86efac;">DISPONIBLE</span>';
  }

  function formatModel(modelo) {
    var raw = esc(modelo || "").trim();
    if (!raw) return "";

    if (/\b5G\s*$/i.test(raw)) {
      return raw.replace(/\b5G\s*$/i, '<span class="stock-tech-tag is-5g">5G</span>');
    }
    if (/\b4G\s*$/i.test(raw)) {
      return raw.replace(/\b4G\s*$/i, '<span class="stock-tech-tag is-4g">4G</span>');
    }

    raw = raw.replace(/(?<!\d)\b5G\b/gi, '<span class="stock-tech-tag is-5g">5G</span>');
    raw = raw.replace(/(?<!\d)\b4G\b/gi, '<span class="stock-tech-tag is-4g">4G</span>');
    return raw;
  }

  function renderStockTable() {
    renderStockSummary();
    var tbody = document.getElementById("stockTbody");
    var filtroEstado = document.getElementById("stockFilterEstado").value;
    var filtroPunto = document.getElementById("stockFilterPunto").value;
    var filtroMarca = document.getElementById("stockFilterMarca").value;
    var filtroTipo = document.getElementById("stockFilterTipo").value;

    var thVenta = document.getElementById("stockThVenta");
    if (thVenta) thVenta.style.display = (filtroEstado === "VENDIDO" || filtroEstado === "") ? "" : "none";

    var filtered = stockItems.filter(function (it) {
      if (filtroEstado && it.estado_stock !== filtroEstado) return false;
      if (filtroPunto && it.tex_normalizado !== filtroPunto) return false;
      if (filtroMarca && it.marca !== filtroMarca) return false;
      if (filtroTipo && it.tipo !== filtroTipo) return false;
      return true;
    });

    filtered.sort(function (a, b) {
      return (a.tex_normalizado || "").localeCompare(b.tex_normalizado || "", "es")
        || (a.marca || "").localeCompare(b.marca || "", "es")
        || (a.modelo || "").localeCompare(b.modelo || "", "es");
    });

    var html = "";
    if (filtered.length === 0) {
      html = '<tr><td colspan="8" style="text-align:center; color:var(--ink-soft); padding:32px;">No se encontraron registros de stock con estos filtros.</td></tr>';
    } else {
      filtered.forEach(function (it) {
        var showVentaTd = (filtroEstado === "VENDIDO" || filtroEstado === "") ? '<td>' + formatDateEs(it.fecha_venta) + '</td>' : '';

        html += '<tr>' +
          '<td><span class="stock-pdv-cell"><span class="stock-pdv-dot"></span>' + esc(it.tex_normalizado || it.pdv_raw) + '</span></td>' +
          '<td>' + brandBadge(it.marca) + '</td>' +
          '<td class="stock-model-cell">' + formatModel(it.modelo || it.descripcion) + '</td>' +
          '<td class="mono"><span class="stock-code-chip">' + esc(it.sku || "-") + '</span></td>' +
          '<td class="mono"><span class="stock-code-chip is-serie">' + esc(it.serie || "-") + '</span></td>' +
          '<td>' + formatDateEs(it.fecha_ingreso) + '</td>' +
          showVentaTd +
          '<td>' + statusBadge(it.estado_stock) + '</td>' +
          '</tr>';
      });
    }
    tbody.innerHTML = html;

    var hint = document.getElementById("stockUpdatedHint");
    var now = new Date();
    hint.textContent = "Base SQL actualizada · Consulta a las " + now.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
  }

  async function getAsesorPdv() {
    var profile = window.currentUserProfile;
    if (!profile || !profile.email || !window.supabaseClient) return null;
    try {
      var cargoRes = await window.supabaseClient
        .from("profiles").select("cargo").eq("email", profile.email).maybeSingle();
      var cargo = (cargoRes.data && cargoRes.data.cargo) || "";
      var isAsesor = norm(cargo) === "ASESOR" || norm(cargo) === "";
      if (isAsesor && profile.pdv) return profile.pdv;
    } catch (_) { }
    return null;
  }

  async function fetchAllStockItems() {
    var allItems = [];
    var pageSize = 1000;
    var from = 0;
    var hasMore = true;

    while (hasMore) {
      var res = await window.supabaseClient
        .from("stock_items")
        .select("*")
        .range(from, from + pageSize - 1);

      if (res.error) throw res.error;
      var data = res.data || [];
      allItems = allItems.concat(data);
      if (data.length < pageSize) {
        hasMore = false;
      } else {
        from += pageSize;
      }
    }
    return allItems;
  }

  window.loadStock = async function () {
    checkAdminUploadVisibility();
    var hint = document.getElementById("stockUpdatedHint");

    if (stockItems.length && Date.now() - stockLoadedAt <= STOCK_CACHE_MS) {
      renderStockTable();
      if (hint) hint.textContent = "Datos en memoria.";
      return;
    }
    if (hint) hint.textContent = "Cargando stock desde la base de datos SQL…";

    try {
      var rawData = await fetchAllStockItems();

      stockItems = rawData.map(function (it) {
        if (it.tex_normalizado) {
          it.tex_normalizado = it.tex_normalizado.replace(/\?/g, "Ñ");
          if (it.tex_normalizado.indexOf("CA?ETE") !== -1 || it.tex_normalizado.indexOf("CANETE") !== -1 || it.tex_normalizado === "SAT CA?ETE") {
            it.tex_normalizado = "TE SATELITE CAÑETE";
          }
        }
        if (it.pdv_raw) {
          it.pdv_raw = it.pdv_raw.replace(/\?/g, "Ñ");
        }
        it.tipo = deriveTipo(it.sku, it.descripcion);
        return it;
      });
      stockLoadedAt = Date.now();
      populateFilters();

      if (!stockDefaultPuntoApplied) {
        stockDefaultPuntoApplied = true;
        var asesorPdv = await getAsesorPdv();
        if (asesorPdv) {
          var puntoSelect = document.getElementById("stockFilterPunto");
          var match = Array.prototype.slice.call(puntoSelect.options).find(function (o) {
            return norm(o.value) === norm(asesorPdv);
          });
          if (match) puntoSelect.value = match.value;
        }
      }

      renderStockTable();
    } catch (e) {
      console.error("Error al cargar stock:", e);
      if (hint) hint.textContent = "No se pudo cargar el stock desde la base SQL.";
    }
  };

  async function handleExcelUpload(file) {
    if (!file || typeof XLSX === "undefined") {
      alert("La librería de lectura Excel (SheetJS) no está lista.");
      return;
    }

    var hint = document.getElementById("stockUpdatedHint");
    if (hint) hint.textContent = "Procesando archivo Excel y cruzando faltantes…";

    try {
      var buffer = await file.arrayBuffer();
      var wb = XLSX.read(buffer, { type: "array" });
      var wsName = wb.SheetNames[0];
      var ws = wb.Sheets[wsName];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

      if (!rows || rows.length < 2) throw new Error("El archivo Excel está vacío.");

      var headers = rows[0].map(norm);
      var idxSSNN = headers.indexOf("SSNN");
      var idxSerie = headers.indexOf("SERIE");
      var idxSku = headers.indexOf("SKU");
      var idxDesc = headers.indexOf("DESCRIPCION");
      if (idxDesc === -1) idxDesc = headers.indexOf("DESCRIPCIÓN");
      var idxOrg = headers.indexOf("ORGANIZACION");
      if (idxOrg === -1) idxOrg = headers.indexOf("ORGANIZACIÓN");
      var idxPdv = headers.indexOf("PUNTO DE VENTA");
      var idxAlm = headers.indexOf("NOMBRE DE ALMACEN");
      if (idxAlm === -1) idxAlm = headers.indexOf("NOMBRE DE ALMACÉN");
      var idxFechaIng = headers.indexOf("FECHA DE INGRESO");

      if (idxSerie === -1) throw new Error("No se encontró la columna SERIE en el Excel.");

      var faltantesSet = await fetchFaltantesSet();
      var parsedItems = [];

      for (var i = 1; i < rows.length; i++) {
        var r = rows[i];
        if (!r || !r.length) continue;

        var ssnn = idxSSNN !== -1 ? norm(r[idxSSNN]) : "";
        if (ssnn && ssnn.indexOf("FORTALECERNOS") === -1) continue;

        var serie = r[idxSerie] ? String(r[idxSerie]).trim() : "";
        if (!serie || serie === "-") continue;

        var sku = idxSku !== -1 ? String(r[idxSku] || "").trim() : "";
        var desc = idxDesc !== -1 ? String(r[idxDesc] || "").trim() : "";
        var org = idxOrg !== -1 ? String(r[idxOrg] || "").trim() : "";
        var pdvRaw = idxPdv !== -1 ? String(r[idxPdv] || "").trim() : "";
        var nomAlm = idxAlm !== -1 ? String(r[idxAlm] || "").trim() : "";
        var rawFechaIng = idxFechaIng !== -1 ? r[idxFechaIng] : null;

        var isFaltante = faltantesSet.has(norm(serie));
        var estadoStock = isFaltante ? "FALTANTE" : "DISPONIBLE";
        var almacenTipo = isFaltante ? "FALTANTE" : (norm(nomAlm).indexOf("NUEVO") !== -1 ? "NUEVO" : "USADO");
        var texNorm = normalizeTex(pdvRaw, org);
        var marca = deriveMarca(sku, desc);
        var tipo = deriveTipo(sku, desc);
        var modeloClean = desc.replace(/^[A-Z0-9_-]+\s*-\s*/i, "").trim() || desc;

        parsedItems.push({
          serie: serie,
          sku: sku,
          descripcion: desc,
          modelo: modeloClean,
          modelo_normalizado: modeloClean,
          marca: marca,
          tipo: tipo,
          pdv_raw: pdvRaw || org,
          tex_normalizado: texNorm,
          almacen_tipo: almacenTipo,
          estado_stock: estadoStock,
          faltante_observacion: isFaltante ? "Reportado en Lista de Faltantes" : null,
          fecha_ingreso: parseDateIso(rawFechaIng)
        });
      }

      if (!parsedItems.length) throw new Error("No se encontraron registros válidos de FORTALECERNOS SAC.");

      // Calcular diff respecto a los disponibles actuales
      var currentDisponibles = stockItems.filter(function (it) { return it.estado_stock === "DISPONIBLE"; });
      var newSeriesSet = new Set(parsedItems.map(function (it) { return norm(it.serie); }));

      var vendidosCount = 0;
      currentDisponibles.forEach(function (it) {
        if (!newSeriesSet.has(norm(it.serie))) vendidosCount++;
      });

      var hoyDateObj = new Date();
      var fechaCargaIso = hoyDateObj.getFullYear() + "-" + String(hoyDateObj.getMonth() + 1).padStart(2, "0") + "-" + String(hoyDateObj.getDate()).padStart(2, "0");
      var fechaVentaCalculadaIso = calculatePreviousDateIso(hoyDateObj);

      pendingUploadPayload = {
        fecha_carga: fechaCargaIso,
        fecha_venta_calculada: fechaVentaCalculadaIso,
        items: parsedItems
      };

      // Abrir Modal de Diferencial
      var modal = document.getElementById("stockDiffModal");
      var elNuevos = document.getElementById("stockDiffNuevos");
      var elVendidos = document.getElementById("stockDiffVendidos");
      var elFaltantes = document.getElementById("stockDiffFaltantes");
      var elTotal = document.getElementById("stockDiffTotal");
      var elFechaVenta = document.getElementById("stockDiffFechaVenta");

      if (elNuevos) elNuevos.textContent = parsedItems.length;
      if (elVendidos) elVendidos.textContent = vendidosCount;
      if (elFaltantes) elFaltantes.textContent = parsedItems.filter(function (i) { return i.estado_stock === "FALTANTE"; }).length;
      if (elTotal) elTotal.textContent = parsedItems.length;
      if (elFechaVenta) elFechaVenta.textContent = "Fecha Venta: " + formatDateEs(fechaVentaCalculadaIso);

      if (modal) {
        modal.hidden = false;
        modal.style.display = "flex";
      }

    } catch (e) {
      alert("Error al procesar el Excel: " + (e.message || e));
      if (hint) hint.textContent = "Error al procesar archivo.";
    }
  }

  async function confirmStockUpload() {
    if (!pendingUploadPayload || !window.supabaseClient) return;

    var btnConfirm = document.getElementById("stockDiffConfirmBtn");
    if (btnConfirm) {
      btnConfirm.disabled = true;
      btnConfirm.textContent = "Guardando en Supabase SQL…";
    }

    try {
      var res = await window.supabaseClient.rpc("xstore_process_stock_upload", {
        p_fecha_carga: pendingUploadPayload.fecha_carga,
        p_fecha_venta_calculada: pendingUploadPayload.fecha_venta_calculada,
        p_items: pendingUploadPayload.items
      });

      if (res.error) throw res.error;

      closeDiffModal();
      pendingUploadPayload = null;
      stockLoadedAt = 0; // Invalida caché
      await window.loadStock();
      alert("¡Stock actualizado con éxito en la base de datos SQL!");
    } catch (e) {
      alert("No se pudo guardar la carga de stock: " + (e.message || JSON.stringify(e)));
    } finally {
      if (btnConfirm) {
        btnConfirm.disabled = false;
        btnConfirm.textContent = "Confirmar y Cargar a Base SQL";
      }
    }
  }

  function closeDiffModal() {
    var modal = document.getElementById("stockDiffModal");
    if (modal) {
      modal.hidden = true;
      modal.style.display = "none";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var estadoSelect = document.getElementById("stockFilterEstado");
    var puntoSelect = document.getElementById("stockFilterPunto");
    var marcaSelect = document.getElementById("stockFilterMarca");
    var tipoSelect = document.getElementById("stockFilterTipo");

    if (estadoSelect) estadoSelect.addEventListener("change", renderStockTable);
    if (puntoSelect) puntoSelect.addEventListener("change", renderStockTable);
    if (marcaSelect) marcaSelect.addEventListener("change", renderStockTable);
    if (tipoSelect) tipoSelect.addEventListener("change", renderStockTable);

    var refreshBtn = document.getElementById("stockRefreshBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", function () {
      stockLoadedAt = 0;
      window.loadStock();
    });

    var fileInp = document.getElementById("stockFileInput");
    if (fileInp) {
      fileInp.addEventListener("change", function (e) {
        if (e.target.files && e.target.files[0]) {
          handleExcelUpload(e.target.files[0]);
          e.target.value = "";
        }
      });
    }

    var btnClose = document.getElementById("stockDiffCloseBtn");
    var btnCancel = document.getElementById("stockDiffCancelBtn");
    var btnConfirm = document.getElementById("stockDiffConfirmBtn");

    if (btnClose) btnClose.addEventListener("click", closeDiffModal);
    if (btnCancel) btnCancel.addEventListener("click", closeDiffModal);
    if (btnConfirm) btnConfirm.addEventListener("click", confirmStockUpload);

    var toggles = document.querySelectorAll(".stock-panel-toggle");
    toggles.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = document.getElementById(btn.getAttribute("data-target"));
        if (!target) return;
        var collapsed = target.classList.toggle("is-collapsed");
        btn.textContent = collapsed ? "Expandir" : "Contraer";
      });
    });
  });
})();
