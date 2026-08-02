(function(){
  // ======================================================================
  // AVANCE LINK — cruza el archivo de VENTAS con el archivo de CUOTAS,
  // filtrado por el PDV del usuario que inició sesión (profiles.pdv).
  //
  // Reparto de cuota entre asesores de una misma tienda:
  //   - Se divide la cuota de tienda entre la cantidad de asesores que
  //     tengan al menos una venta subida a ese PDV en el mes seleccionado,
  //     EXCLUYENDO a los que estén puestos en 0% (ese % pasa a repartirse
  //     entre el resto, es decir se divide entre menos gente).
  //   - Cada asesor tiene además un % editable (por defecto 100%) que se
  //     guarda en Supabase (tabla cuota_ajustes) por PDV + mes + nombre,
  //     y multiplica esa cuota individual. En 0% su cuota mostrada es 0 y
  //     no cuenta para el divisor, pero su venta sigue sumando al total
  //     de tienda.
  //   - Hay un selector de mes para revisar meses anteriores.
  // ======================================================================
  var VENTAS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSKUPtQOobapucdj6Izz7ZO2BT20Gws-RbXzeSxo733C7EZHOgscVXx7BDj_2JghU8PeNMvlN6Jrqb3/pub?gid=913526210&single=true&output=csv";
  var CUOTAS_CSV_URL  = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQpLv-8sIjq2VUpI1ojiB5_yVUrghwgDB35IldFD9tzGHK5L4-a-8OSwgUeSuM1T_8b2qON-FK64pJJ/pub?gid=948625095&single=true&output=csv";
  var CUOTAS_DIA_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS25edYoYsxDcSJQ2OkVFpF-fFZVykQB-E71dCrCizb2FKpiArI3OuwmBtnZF76PFXDAJbYQD27pzbd/pub?gid=948625095&single=true&output=csv";
  var ARRIBOS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSKUPtQOobapucdj6Izz7ZO2BT20Gws-RbXzeSxo733C7EZHOgscVXx7BDj_2JghU8PeNMvlN6Jrqb3/pub?gid=0&single=true&output=csv";

  var MONTH_NAMES_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio",
    "Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  // Categorías de comisión: a qué valores de la columna "Transacción" corresponde cada una,
  // y si requieren que el Plan Vendido tenga un cargo fijo >= 49.90.
  var CATEGORIES = [
    { id:"oss",       label:"OSS MONO + OSS LLAA",  cuotaProducto:"PORTA OSS",
      txns:["PORTA OSS LLAA BASE","PORTA OSS LLAA CAPTURA","PORTA OSS MONO"], requiresPlan49:false },
    { id:"opp",       label:"OPP BASE",             cuotaProducto:"PORTA OPP",
      txns:["PORTA OPP BASE","PORTA OPP LLAA BASE"], requiresPlan49:false },
    { id:"vrbase",    label:"VR LLAA BASE",         cuotaProducto:"VR BASE",
      txns:["VR LLAA BASE"], requiresPlan49:false },
    { id:"vrcaptura", label:"VR CAPTURA",           cuotaProducto:"VR CAPTURA",
      txns:["VR LLAA CAPTURA","VR MONO"], requiresPlan49:false },
    { id:"reno",      label:"RENO SS ≥ 49.90",      cuotaProducto:"RENO SS",
      txns:["RENO SS"], requiresPlan49:true },
    { id:"pack",      label:"PACK SS ≥ 49.90",      cuotaProducto:"PACKS",
      txns:["PORTA OSS LLAA BASE","PORTA OSS LLAA CAPTURA","PORTA OSS MONO","PORTA OPP LLAA BASE","VR LLAA BASE"], requiresPlan49:true, requiresModalidad:true },
    { id:"prepago",   label:"Prepago",              cuotaProducto:"PREPAGO",
      txns:["PREPAGO"], requiresPlan49:false }
  ];

  function normA(s){
    return (s || "").toString().trim().toUpperCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z0-9]+/g, " ").trim();
  }

  function escapeHtmlAv(s){
    return (s || "").toString().replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  function findCol(headers, aliases){
    var normHeaders = headers.map(normA);
    for(var i=0; i<aliases.length; i++){
      var idx = normHeaders.indexOf(normA(aliases[i]));
      if(idx !== -1) return idx;
    }
    return -1;
  }

  function parseCSVav(text){
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    for(var i=0; i<text.length; i++){
      var c = text[i];
      if(inQuotes){
        if(c === '"'){
          if(text[i+1] === '"'){ field += '"'; i++; }
          else{ inQuotes = false; }
        }else{
          field += c;
        }
      }else{
        if(c === '"'){ inQuotes = true; }
        else if(c === ','){ row.push(field); field = ""; }
        else if(c === '\n'){ row.push(field); rows.push(row); row = []; field = ""; }
        else if(c === '\r'){ /* ignorar */ }
        else{ field += c; }
      }
    }
    if(field.length || row.length){ row.push(field); rows.push(row); }
    return rows.filter(function(r){ return r.length > 1 || (r[0] && r[0].trim() !== ""); });
  }

  async function fetchCsvText(url){
    var sep = url.indexOf("?") === -1 ? "?" : "&";
    var res = await fetch(url + sep + "_=" + Date.now());
    if(!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  }

  function parseLooseDate(v){
    if(!v) return null;
    var s = v.toString().trim();
    var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if(iso) return new Date(parseInt(iso[1]), parseInt(iso[2])-1, parseInt(iso[3]));
    var slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // formato M/D/YYYY del archivo de cuotas
    if(slash) return new Date(parseInt(slash[3]), parseInt(slash[1])-1, parseInt(slash[2]));
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function monthKey(d){
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }
  function monthLabel(d){
    return MONTH_NAMES_ES[d.getMonth()] + " " + d.getFullYear();
  }
  function daysInMonth(year, monthIndex0){
    return new Date(year, monthIndex0 + 1, 0).getDate();
  }
  function isWorkingDayAv(date){ return date.getDay() !== 0; } // lunes a sábado
  function workingDaysInMonthAv(year, monthIndex0){
    var last = daysInMonth(year, monthIndex0), total = 0;
    for(var day = 1; day <= last; day++) if(isWorkingDayAv(new Date(year, monthIndex0, day))) total++;
    return total;
  }
  function workingDaysBeforeAv(date){
    var total = 0;
    for(var day = 1; day < date.getDate(); day++) if(isWorkingDayAv(new Date(date.getFullYear(), date.getMonth(), day))) total++;
    return total;
  }

  function parsePlanFee(planStr){
    var matches = (planStr || "").toString().match(/\d+(?:\.\d+)?/g);
    if(!matches || !matches.length) return 0;
    return parseFloat(matches[matches.length - 1]);
  }
  function planFeeOk(planStr){ return parsePlanFee(planStr) >= 49.90; }
  function modalidadOk(modStr){
    var m = normA(modStr);
    return m === "FINANCIADO" || m === "CONTADO";
  }

  function numLocal(n){
    if(n === null || n === undefined || isNaN(n)) return "—";
    return Math.round(n).toLocaleString("es-PE");
  }
  function pctLocal(n){
    if(n === null || n === undefined || isNaN(n) || !isFinite(n)) return "—";
    return (n * 100).toLocaleString("es-PE", {minimumFractionDigits:1, maximumFractionDigits:1}) + "%";
  }
  function statusClassLocal(cump){
    if(cump === null || cump === undefined) return "";
    return cump >= 1 ? "status-good" : "status-bad";
  }

  function buildRowsForCuotaSet(cuotaMap, counts, totalDias, diasTranscurridos){
    function cuotaFor(prodKey){ return (cuotaMap && cuotaMap[normA(prodKey)]) || 0; }
    var ossQ = cuotaFor("PORTA OSS"), oppQ = cuotaFor("PORTA OPP"),
        vrbaseQ = cuotaFor("VR BASE"), vrcapturaQ = cuotaFor("VR CAPTURA");
    var ssTotalQ = ossQ + oppQ + vrbaseQ + vrcapturaQ;
    var ossV = (counts && counts.oss) || 0, oppV = (counts && counts.opp) || 0,
        vrbaseV = (counts && counts.vrbase) || 0, vrcapturaV = (counts && counts.vrcaptura) || 0;
    var ssTotalV = ossV + oppV + vrbaseV + vrcapturaV;

    var rows = [
      { label:"SS TOTAL",              cuota:ssTotalQ,           venta:ssTotalV },
      { label:"OSS MONO + OSS LLAA",   cuota:ossQ,               venta:ossV },
      { label:"OPP BASE",              cuota:oppQ,               venta:oppV },
      { label:"VR LLAA BASE",          cuota:vrbaseQ,            venta:vrbaseV },
      { label:"VR CAPTURA",            cuota:vrcapturaQ,         venta:vrcapturaV },
      { label:"RENO SS ≥ 49.90",       cuota:cuotaFor("RENO SS"),venta:(counts && counts.reno) || 0 },
      { label:"PACK SS ≥ 49.90",       cuota:cuotaFor("PACKS"),  venta:(counts && counts.pack) || 0 },
      { label:"Prepago",               cuota:cuotaFor("PREPAGO"),venta:(counts && counts.prepago) || 0 }
    ];

    rows.forEach(function(row){
      if(row.noVenta){
        row.avance = row.ideal = row.desfase = row.proy = row.cump = null;
        return;
      }
      if(row.cuota <= 0){
        row.avance = row.ideal = row.desfase = row.proy = row.cump = null;
        return;
      }
      row.avance = row.venta / row.cuota;
      row.ideal = row.cuota * (diasTranscurridos / totalDias);
      row.desfase = row.venta - row.ideal;
      row.proy = diasTranscurridos > 0 ? (row.venta / diasTranscurridos * totalDias) : 0;
      row.cump = row.proy / row.cuota;
    });
    return rows;
  }

  function renderTableRows(rows){
    return rows.map(function(r){
      if(r.noVenta){
        return '<tr><td><span class="pname">' + escapeHtmlAv(r.label) + '</span></td>' +
          '<td>S/ ' + (r.cuota || 0).toLocaleString("es-PE",{minimumFractionDigits:2, maximumFractionDigits:2}) + '</td>' +
          '<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>';
      }
      if(r.avance === null){
        return '<tr><td><span class="pname">' + escapeHtmlAv(r.label) + '</span></td>' +
          '<td>' + numLocal(r.cuota) + '</td>' +
          '<td>' + numLocal(r.venta) + '</td>' +
          '<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>';
      }
      var barPct = Math.max(0, Math.min(100, r.avance * 100));
      var barColor = r.avance >= 1 ? "var(--good)" : (r.avance >= 0.7 ? "var(--warn)" : "var(--bad)");
      return '<tr><td><span class="pname">' + escapeHtmlAv(r.label) + '</span></td>' +
        '<td>' + numLocal(r.cuota) + '</td>' +
        '<td>' + numLocal(r.venta) + '</td>' +
        '<td><div class="bar-track"><div class="bar-fill" style="width:' + barPct + '%; background:' + barColor + '"></div></div>' +
          '<span class="cump-pct">' + pctLocal(r.avance) + '</span></td>' +
        '<td>' + numLocal(r.ideal) + '</td>' +
        '<td>' + (r.desfase >= 0 ? "+" : "") + numLocal(r.desfase) + '</td>' +
        '<td>' + numLocal(r.proy) + '</td>' +
        '<td class="' + statusClassLocal(r.cump) + '">' + pctLocal(r.cump) + '</td></tr>';
    }).join("");
  }

  function tableShell(rowsHtml){
    return '<div class="table-scroll"><table><thead><tr>' +
      '<th>Productos</th><th>Cuota</th><th>Venta</th><th>Avance</th><th>Ideal</th><th>Desfase</th><th>Proy</th><th>Cumplimiento</th>' +
    '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
  }

  // ------------------------------------------------------------------
  // Estado en memoria del último cálculo, para poder recalcular una sola
  // tarjeta de asesor cuando cambia su % sin tener que rehacer todo.
  // ------------------------------------------------------------------
  var _ctx = null; // { myPdvNorm, storeCuotasForMonth, totalDias, diasTranscurridos, countsByAdvisor, N, ajustes, pdvDisplay, mesKey }
  var _isAsesor = true;
  var _canEditAjustes = false;
  var _selectedPdv = null;
  var _storesDirectory = []; // [{norm, name}] — todas las tiendas encontradas en el archivo de cuotas

  function computeAdvisorRows(advisorNorm){
    var pct = (_ctx.ajustes[advisorNorm] !== undefined) ? _ctx.ajustes[advisorNorm] : 100;
    var share = (1 / _ctx.N) * (pct / 100);
    var advisorCuotas = {};
    Object.keys(_ctx.storeCuotasForMonth || {}).forEach(function(prodNorm){
      advisorCuotas[prodNorm] = _ctx.storeCuotasForMonth[prodNorm] * share;
    });
    var advisorCounts = _ctx.countsByAdvisor[advisorNorm] || {};
    return { rows: buildRowsForCuotaSet(advisorCuotas, advisorCounts, _ctx.totalDias, _ctx.diasTranscurridos), pct: pct };
  }

  function renderAdvisorCard(rawName){
    var advisorNorm = normA(rawName);
    var built = computeAdvisorRows(advisorNorm);
    return '<section class="table-card" data-advisor="' + escapeHtmlAv(advisorNorm) + '">' +
      '<div class="heading avance-card-title">' +
        '<div><h2>' + escapeHtmlAv(rawName) +
          '<span class="avance-pct-wrap"><label>Cuota %</label>' +
            '<input type="number" min="0" max="500" step="1" class="avance-pct-input" value="' + built.pct + '"' +
              (_canEditAjustes ? '' : ' disabled title="Solo Supervisores pueden modificar la cuota."') + '></span>' +
        '</h2><span class="avance-sub">Asesor · ' + monthLabel(_ctx.monthDate) + '</span></div>' +
      '</div>' +
      tableShell(renderTableRows(built.rows)) +
    '</section>';
  }

  function reRenderAdvisorCard(advisorNorm){
    var wrap = document.querySelector('#avanceAsesoresHolder [data-advisor="' + advisorNorm + '"]');
    if(!wrap) return;
    var built = computeAdvisorRows(advisorNorm);
    var tableScroll = wrap.querySelector(".table-scroll");
    if(tableScroll) tableScroll.outerHTML = tableShell(renderTableRows(built.rows));
  }

  // Recalcula cuántos asesores comparten la cuota (excluye a los que están en 0%)
  // y vuelve a pintar todas las tarjetas de asesor, ya que el cambio de uno afecta
  // el reparto de todos los demás.
  function recalcNAndRerenderAll(){
    if(!_ctx || !_ctx.advisorNames) return;
    _ctx.N = _ctx.advisorNames.filter(function(name){
      return _ctx.ajustes[normA(name)] !== 0;
    }).length || 1;

    _ctx.advisorNames.forEach(function(name){
      reRenderAdvisorCard(normA(name));
    });

    var sub = document.querySelector("#avanceStoreCardHolder .avance-sub");
    if(sub){
      var total = _ctx.advisorNames.length;
      sub.textContent = "Avance de tienda · " + monthLabel(_ctx.monthDate) + " · " + total + " asesor(es) con ventas" +
        (_ctx.N !== total ? " · cuota repartida entre " + _ctx.N : "");
    }
  }

  async function saveAjuste(advisorNorm, pct){
    try{
      await window.supabaseClient.from("cuota_ajustes").upsert({
        pdv: _ctx.pdvDisplay,
        mes: _ctx.mesKey,
        asesor_nombre: advisorNorm,
        porcentaje: pct
      }, { onConflict: "pdv,mes,asesor_nombre" });
    }catch(e){ console.error("No se pudo guardar el % de reparto:", e); }
  }

  document.addEventListener("change", function(e){
    if(!e.target.matches(".avance-pct-input")) return;
    if(!_ctx || !_canEditAjustes) return;
    var card = e.target.closest("[data-advisor]");
    if(!card) return;
    var advisorNorm = card.getAttribute("data-advisor");
    var pct = parseFloat(e.target.value);
    if(isNaN(pct) || pct < 0) pct = 0;
    e.target.value = pct;
    _ctx.ajustes[advisorNorm] = pct;
    recalcNAndRerenderAll();
    saveAjuste(advisorNorm, pct);
  });

  // ------------------------------------------------------------------
  // Carga y parseo (una sola vez por click en "Actualizar" o al abrir la vista)
  // ------------------------------------------------------------------
  var _raw = null; // { cHeaders, cRows, vHeaders, vRows, cIdx, vIdx }
  var _rawLoadedAt = 0;
  var DATA_CACHE_MS_AV = 3 * 60 * 1000;

  async function loadRawData(){
    var texts = await Promise.all([fetchCsvText(CUOTAS_CSV_URL), fetchCsvText(VENTAS_CSV_URL)]);
    var cuotasTable = parseCSVav(texts[0]);
    var ventasTable = parseCSVav(texts[1]);
    if(cuotasTable.length < 2 || ventasTable.length < 2){
      throw new Error("Archivos vacíos o ilegibles.");
    }
    var cHeaders = cuotasTable[0], cRows = cuotasTable.slice(1);
    var vHeaders = ventasTable[0], vRows = ventasTable.slice(1);

    var cIdx = {
      mes: findCol(cHeaders, ["MES"]),
      pdvs: findCol(cHeaders, ["PDVS"]),
      producto: findCol(cHeaders, ["PRODUCTO"]),
      cuota: findCol(cHeaders, ["CUOTA"])
    };
    var vIdx = {
      fecha: findCol(vHeaders, ["FECHA DE VENTA"]),
      tienda: findCol(vHeaders, ["TIENDA"]),
      asesor: findCol(vHeaders, ["ASESOR"]),
      transaccion: findCol(vHeaders, ["TRANSACCION","TRANSACCIÓN"]),
      orden: findCol(vHeaders, ["ORDEN","N° ORDEN","Nº ORDEN","N° DE ORDEN","Nº DE ORDEN","NRO ORDEN","NRO DE ORDEN","NUMERO DE ORDEN","NÚMERO DE ORDEN","ORDER ID"]),
      concreto: findCol(vHeaders, ["SE CONCRETO LA VENTA","¿SE CONCRETO LA VENTA?"]),
      plan: findCol(vHeaders, ["PLAN VENDIDO"]),
      modalidad: findCol(vHeaders, ["MODALIDAD DE VENTA","MODALIDAD VENTA","MODALIDAD"])
    };

    if(cIdx.pdvs === -1 || cIdx.producto === -1 || cIdx.cuota === -1 ||
       vIdx.tienda === -1 || vIdx.transaccion === -1 || vIdx.fecha === -1){
      throw new Error("Faltan columnas esperadas en los archivos.");
    }
    return { cHeaders:cHeaders, cRows:cRows, vHeaders:vHeaders, vRows:vRows, cIdx:cIdx, vIdx:vIdx };
  }

  function buildStoresDirectory(raw){
    var seen = {};
    var list = [];
    raw.cRows.forEach(function(r){
      var name = (r[raw.cIdx.pdvs] || "").trim();
      if(!name) return;
      var norm = normA(name);
      if(!seen[norm]){ seen[norm] = true; list.push({ norm:norm, name:name }); }
    });
    list.sort(function(a,b){ return a.name.localeCompare(b.name, "es"); });
    return list;
  }

  function populatePdvSelect(stores, selectedNorm){
    var sel = document.getElementById("avancePdvSelect");
    sel.innerHTML = stores.map(function(s){
      return '<option value="' + escapeHtmlAv(s.name) + '"' + (s.norm === selectedNorm ? " selected" : "") + '>' +
        escapeHtmlAv(s.name) + '</option>';
    }).join("");
  }

  function buildAvailableMonths(raw){
    var months = {}; // key -> Date (primer día del mes)
    raw.cRows.forEach(function(r){
      var d = parseLooseDate(r[raw.cIdx.mes]);
      if(d) months[monthKey(d)] = new Date(d.getFullYear(), d.getMonth(), 1);
    });
    raw.vRows.forEach(function(r){
      var d = parseLooseDate(r[raw.vIdx.fecha]);
      if(d) months[monthKey(d)] = new Date(d.getFullYear(), d.getMonth(), 1);
    });
    var keys = Object.keys(months).sort().reverse();
    return keys.map(function(k){ return { key:k, date:months[k] }; });
  }

  function populateMonthSelect(monthsList, selectedKey){
    var sel = document.getElementById("avanceMonthSelect");
    sel.innerHTML = monthsList.map(function(m){
      return '<option value="' + m.key + '"' + (m.key === selectedKey ? " selected" : "") + '>' +
        escapeHtmlAv(monthLabel(m.date)) + '</option>';
    }).join("");
  }

  // Vista operativa del día. El turno se proyecta dentro de la franja 08:00–21:00
  // (13 horas); no se infieren horas fuera de ese horario.
  var OPERATING_HOURS = 13;
  var _dayViewOpen = false;

  function currentOperatingHours(){
    var now = new Date();
    var current = now.getHours() + (now.getMinutes() / 60);
    return Math.max(0, Math.min(OPERATING_HOURS, current - 8));
  }
  function dateKeyAv(d){
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function countConcreteSales(raw, row){
    return raw.vIdx.concreto === -1 || normA(row[raw.vIdx.concreto]) === "SI";
  }

  function getOrderCountStatus(raw, row){
    if(!countConcreteSales(raw, row)) return { considered:false, reason:"No: venta no concretada" };
    var txn = normA(row[raw.vIdx.transaccion]);
    var plan = raw.vIdx.plan !== -1 ? row[raw.vIdx.plan] : "";
    var modalidad = raw.vIdx.modalidad !== -1 ? row[raw.vIdx.modalidad] : "";
    var matchingCategories = CATEGORIES.filter(function(cat){
      return cat.txns.some(function(t){ return normA(t) === txn; });
    });
    if(!matchingCategories.length) return { considered:false, reason:"No: transacción no incluida" };
    var isConsidered = matchingCategories.some(function(cat){
      return (!cat.requiresPlan49 || planFeeOk(plan)) &&
        (!cat.requiresModalidad || modalidadOk(modalidad));
    });
    if(isConsidered) return { considered:true, reason:"Sí: considerada para el conteo" };
    var failsPlan = matchingCategories.some(function(cat){ return cat.requiresPlan49; }) && !planFeeOk(plan);
    var failsModalidad = matchingCategories.some(function(cat){ return cat.requiresModalidad; }) && !modalidadOk(modalidad);
    if(failsPlan && failsModalidad) return { considered:false, reason:"No: plan menor a S/ 49.90 y modalidad no válida" };
    if(failsPlan) return { considered:false, reason:"No: plan menor a S/ 49.90" };
    if(failsModalidad) return { considered:false, reason:"No: modalidad no válida" };
    return { considered:false, reason:"No: no cumple las condiciones del conteo" };
  }

  function getOrdersForAvance(){
    if(!_raw || !_ctx) return [];
    return _raw.vRows.filter(function(row){
      var date = parseLooseDate(row[_raw.vIdx.fecha]);
      var store = (_raw.vIdx.tienda === -1 ? "" : (row[_raw.vIdx.tienda] || "")).trim();
      return date && monthKey(date) === _ctx.mesKey && normA(store) === _ctx.myPdvNorm;
    });
  }

  function orderCell(raw, row, index){
    return index === -1 ? "—" : ((row[index] || "").toString().trim() || "—");
  }

  function renderConsideredOrders(){
    var body = document.getElementById("avanceOrdersBody");
    var advisorFilter = document.getElementById("avanceOrdersAdvisorFilter");
    var notCountedButton = document.getElementById("avanceOrdersNotCounted");
    var count = document.getElementById("avanceOrdersCount");
    var description = document.getElementById("avanceOrdersDescription");
    if(!body || !advisorFilter || !_raw || !_ctx) return;

    var orders = getOrdersForAvance();
    var advisors = {};
    orders.forEach(function(row){
      var name = orderCell(_raw, row, _raw.vIdx.asesor);
      if(name !== "—") advisors[normA(name)] = name;
    });
    var selectedAdvisor = advisorFilter.value;
    advisorFilter.innerHTML = '<option value="">Todos los asesores</option>' + Object.keys(advisors).sort(function(a,b){ return advisors[a].localeCompare(advisors[b], "es"); }).map(function(key){
      return '<option value="' + escapeHtmlAv(key) + '">' + escapeHtmlAv(advisors[key]) + '</option>';
    }).join("");
    advisorFilter.value = advisors[selectedAdvisor] ? selectedAdvisor : "";

    var onlyNotCounted = notCountedButton && notCountedButton.getAttribute("aria-pressed") === "true";
    var visibleOrders = orders.filter(function(row){
      var matchesAdvisor = !advisorFilter.value || normA(orderCell(_raw, row, _raw.vIdx.asesor)) === advisorFilter.value;
      return matchesAdvisor && (!onlyNotCounted || !getOrderCountStatus(_raw, row).considered);
    });
    body.innerHTML = visibleOrders.length ? visibleOrders.map(function(row){
      var status = getOrderCountStatus(_raw, row);
      return '<tr><td>' + escapeHtmlAv(orderCell(_raw, row, _raw.vIdx.fecha)) + '</td>' +
        '<td>' + escapeHtmlAv(orderCell(_raw, row, _raw.vIdx.tienda)) + '</td>' +
        '<td>' + escapeHtmlAv(orderCell(_raw, row, _raw.vIdx.asesor)) + '</td>' +
        '<td>' + escapeHtmlAv(orderCell(_raw, row, _raw.vIdx.transaccion)) + '</td>' +
        '<td>' + escapeHtmlAv(orderCell(_raw, row, _raw.vIdx.orden)) + '</td>' +
        '<td>' + escapeHtmlAv(orderCell(_raw, row, _raw.vIdx.plan)) + '</td>' +
        '<td>' + escapeHtmlAv(orderCell(_raw, row, _raw.vIdx.modalidad)) + '</td>' +
        '<td><span class="avance-order-status ' + (status.considered ? 'is-counted' : 'is-not-counted') + '">' + escapeHtmlAv(status.reason) + '</span></td></tr>';
    }).join("") : '<tr><td class="avance-orders-empty" colspan="8">No hay órdenes para este filtro.</td></tr>';
    var totalConsidered = visibleOrders.filter(function(row){ return getOrderCountStatus(_raw, row).considered; }).length;
    count.textContent = visibleOrders.length + " orden" + (visibleOrders.length === 1 ? "" : "es") + " · " + totalConsidered + " considerada" + (totalConsidered === 1 ? "" : "s");
    var totalOrdersConsidered = orders.filter(function(row){ return getOrderCountStatus(_raw, row).considered; }).length;
    description.textContent = (_ctx.pdvDisplay || "PDV") + " · " + monthLabel(_ctx.monthDate) + " · " + orders.length + " órdenes en total · " + totalOrdersConsidered + " consideradas para el conteo.";
  }
  function pctLocalDay(n){
    if(n === null || n === undefined || isNaN(n) || !isFinite(n)) return "—";
    return Math.round(n * 100).toLocaleString("es-PE") + "%";
  }
  function dayMetricCells(metric){
    var alcance = metric.ventaDia === 0 ? 0 : (metric.expectedNow > 0 ? (metric.ventaDia / metric.expectedNow) - 1 : 0);
    var proy = metric.hoursOpen > 0 ? metric.ventaDia / metric.hoursOpen * OPERATING_HOURS : 0;
    var proyPct = metric.cuotaDia > 0 ? (proy / metric.cuotaDia) - 1 : null;
    function signed(n){ return (n > 0 ? "+" : "") + numLocal(n); }
    var desfaseClass = metric.desfase >= 0 ? 'is-good' : 'is-bad';
    var ventaDiaClass = metric.ventaDia > 0 ? 'is-good' : 'is-muted';
    return '<td>' + numLocal(metric.cuota) + '</td><td>' + numLocal(metric.venta) + '</td>' +
      '<td><span class="avance-day-indicator ' + desfaseClass + '">' + signed(metric.desfase) + '</span></td>' +
      '<td>' + numLocal(metric.cuotaDia) + '</td><td>' + numLocal(metric.cuotaDiaRecalculada) + '</td>' +
      '<td><span class="avance-day-indicator ' + ventaDiaClass + '">' + numLocal(metric.ventaDia) + '</span></td><td class="' + (alcance < 0 ? 'avance-day-negative' : '') + '">' + pctLocalDay(alcance) + '</td>' +
      '<td>' + numLocal(proy) + '</td><td class="' + (proyPct !== null && proyPct < 0 ? 'avance-day-negative' : '') + '">' + pctLocalDay(proyPct) + '</td>';
  }
  function arribosIndicator(value){
    return '<span class="avance-day-indicator ' + (value > 0 ? 'is-info' : 'is-muted') + '">' + numLocal(value) + '</span>';
  }
  function conversionIndicator(value){
    var state = value === null || value === undefined ? 'is-muted' : (value >= .35 ? 'is-good' : (value > 0 ? 'is-warn' : 'is-muted'));
    return '<span class="avance-day-indicator ' + state + '">' + pctLocalDay(value) + '</span>';
  }
  async function renderDayAdvance(selectedKey){
    var holder = document.getElementById("avanceDayHolder");
    if(!holder || !_raw) return;
    var raw = _raw, monthInfo = buildAvailableMonths(raw).find(function(m){ return m.key === selectedKey; });
    if(!monthInfo){ holder.innerHTML = ""; return; }
    var totalDays = daysInMonth(monthInfo.date.getFullYear(), monthInfo.date.getMonth());
    var totalWorkingDays = workingDaysInMonthAv(monthInfo.date.getFullYear(), monthInfo.date.getMonth());
    var now = new Date(), todayKey = dateKeyAv(now), hoursOpen = currentOperatingHours();
    var isCurrentMonth = monthKey(now) === selectedKey;
    var stores = {}, salesByStore = {}, salesTodayByStore = {}, advisors = {}, ajustesPorPdv = {};
    try{
      var ajustesRes = await window.supabaseClient.from("cuota_ajustes")
        .select("pdv, asesor_nombre, porcentaje").eq("mes", selectedKey);
      (ajustesRes.data || []).forEach(function(row){
        var pdvKey = normA(row.pdv), advisorKey = normA(row.asesor_nombre);
        if(!ajustesPorPdv[pdvKey]) ajustesPorPdv[pdvKey] = {};
        ajustesPorPdv[pdvKey][advisorKey] = Number(row.porcentaje);
      });
    }catch(e){ /* Sin ajustes: se reparte la cuota en partes iguales. */ }
    raw.cRows.forEach(function(r){
      var d = parseLooseDate(r[raw.cIdx.mes]);
      if(!d || monthKey(d) !== selectedKey) return;
      var name = (r[raw.cIdx.pdvs] || "").trim(); if(!name) return;
      var key = normA(name), quota = parseFloat((r[raw.cIdx.cuota] || "").toString().replace(",",".")) || 0;
      if(!stores[key]) stores[key] = { name:name, cuota:0 };
      stores[key].cuota += quota;
    });
    raw.vRows.forEach(function(r){
      var d = parseLooseDate(r[raw.vIdx.fecha]);
      if(!d || monthKey(d) !== selectedKey || !countConcreteSales(raw,r)) return;
      var storeName = (r[raw.vIdx.tienda] || "").trim(); if(!storeName) return;
      var storeKey = normA(storeName), advisorName = raw.vIdx.asesor === -1 ? "Sin asesor" : ((r[raw.vIdx.asesor] || "").trim() || "Sin asesor");
      if(!stores[storeKey]) stores[storeKey] = { name:storeName, cuota:0 };
      salesByStore[storeKey] = (salesByStore[storeKey] || 0) + 1;
      if(isCurrentMonth && dateKeyAv(d) === todayKey) salesTodayByStore[storeKey] = (salesTodayByStore[storeKey] || 0) + 1;
      if(!advisors[storeKey]) advisors[storeKey] = {};
      var advisorKey = normA(advisorName);
      if(!advisors[storeKey][advisorKey]) advisors[storeKey][advisorKey] = { name:advisorName, venta:0, ventaDia:0, productos:{} };
      advisors[storeKey][advisorKey].venta++;
      if(isCurrentMonth && dateKeyAv(d) === todayKey) advisors[storeKey][advisorKey].ventaDia++;
      var txn = normA(r[raw.vIdx.transaccion]), plan = raw.vIdx.plan === -1 ? "" : r[raw.vIdx.plan], modalidad = raw.vIdx.modalidad === -1 ? "" : r[raw.vIdx.modalidad];
      CATEGORIES.forEach(function(cat){
        var match = cat.txns.some(function(t){ return normA(t) === txn; });
        if(!match || (cat.requiresPlan49 && !planFeeOk(plan)) || (cat.requiresModalidad && !modalidadOk(modalidad))) return;
        if(!advisors[storeKey][advisorKey].productos[cat.id]) advisors[storeKey][advisorKey].productos[cat.id] = { venta:0, ventaDia:0 };
        advisors[storeKey][advisorKey].productos[cat.id].venta++;
        if(isCurrentMonth && dateKeyAv(d) === todayKey) advisors[storeKey][advisorKey].productos[cat.id].ventaDia++;
      });
    });
    var selectedNorm = _selectedPdv ? normA(_selectedPdv) : null;
    var storeKeys = Object.keys(stores).filter(function(k){ return !selectedNorm || k === selectedNorm; }).sort(function(a,b){ return stores[a].name.localeCompare(stores[b].name,"es"); });
    function metric(quota, venta, ventaDia, advisorCount){
      var cuotaDia = quota / totalDays;
      var remainingDays = Math.max(1, totalDays - (isCurrentMonth ? now.getDate() - 1 : totalDays - 1));
      return { cuota:quota, venta:venta, desfase:venta-quota, cuotaDia:cuotaDia,
        cuotaDiaRecalculada:Math.max(0,(quota-venta) / remainingDays), ventaDia:ventaDia,
        expectedNow:cuotaDia * (hoursOpen / OPERATING_HOURS), hoursOpen:hoursOpen, advisorCount:advisorCount };
    }
    var body = storeKeys.map(function(key){
      var store = stores[key], advisorList = Object.keys(advisors[key] || {}).map(function(k){ return advisors[key][k]; }).sort(function(a,b){ return a.name.localeCompare(b.name,"es"); });
      var storeMetric = metric(store.cuota, salesByStore[key] || 0, salesTodayByStore[key] || 0, advisorList.length);
      var activeAdvisors = advisorList.filter(function(advisor){ return (ajustesPorPdv[key] || {})[normA(advisor.name)] !== 0; }).length || 1;
      var rows = '<tr class="avance-day-store" data-day-store="' + escapeHtmlAv(key) + '"><td><button type="button" class="avance-day-expand" data-day-toggle="store" data-day-key="' + escapeHtmlAv(key) + '" aria-expanded="false">▶</button><strong>' + escapeHtmlAv(store.name) + '</strong></td>' + dayMetricCells(storeMetric) + '</tr>';
      rows += advisorList.map(function(advisor){
        var advisorKey = normA(advisor.name), pct = (ajustesPorPdv[key] || {})[advisorKey];
        if(pct === undefined) pct = 100;
        var share = (pct === 0 ? 0 : (pct / 100) / activeAdvisors);
        var advisorMetric = metric(store.cuota * share, advisor.venta, advisor.ventaDia, 0);
        var productRows = CATEGORIES.map(function(cat){
          var productQuota = 0;
          raw.cRows.forEach(function(r){
            var date = parseLooseDate(r[raw.cIdx.mes]);
            if(date && monthKey(date) === selectedKey && normA(r[raw.cIdx.pdvs]) === key && normA(r[raw.cIdx.producto]) === normA(cat.cuotaProducto)) productQuota += parseFloat((r[raw.cIdx.cuota] || "").toString().replace(",",".")) || 0;
          });
          var sales = advisor.productos[cat.id] || { venta:0, ventaDia:0 };
          return '<tr class="avance-day-product" data-day-product-parent="' + escapeHtmlAv(key + "|" + advisorKey) + '" hidden><td><span class="avance-day-product-name">' + escapeHtmlAv(cat.label) + '</span></td>' + dayMetricCells(metric(productQuota * share, sales.venta, sales.ventaDia, 0)) + '</tr>';
        }).join("");
        return '<tr class="avance-day-advisor" data-day-parent="' + escapeHtmlAv(key) + '" hidden><td><button type="button" class="avance-day-expand" data-day-toggle="advisor" data-day-key="' + escapeHtmlAv(key + "|" + advisorKey) + '" aria-expanded="false">▶</button>' + escapeHtmlAv(advisor.name) + '<span class="avance-day-share">Cuota ' + pct + '%</span></td>' + dayMetricCells(advisorMetric) + '</tr>' + productRows;
      }).join("");
      return rows;
    }).join("");
    holder.innerHTML = '<section class="table-card avance-day-card"><div class="heading"><div><h2>Avance día</h2><span class="avance-sub">Árbol PDV → asesor → producto. La cuota del asesor usa el % configurado por supervisión. Proyección: ' + OPERATING_HOURS + ' horas operativas (08:00–21:00).' + (!isCurrentMonth ? ' El día solo se proyecta para el mes actual.' : '') + '</span></div></div><div class="table-scroll"><table class="avance-day-table"><thead><tr><th>PDV / Asesor / Producto</th><th>Cuota 1-' + totalDays + '</th><th>Venta 1-' + totalDays + '</th><th>Desfase</th><th>Cuota día</th><th>Cuota día recalculada</th><th>Venta día</th><th>Alcance</th><th>Proyección (und)</th><th>Proyección (%)</th></tr></thead><tbody>' + (body || '<tr><td colspan="10">No hay datos para el filtro seleccionado.</td></tr>') + '</tbody></table></div></section>';
  }

  var _selectedDayPdvs = [];
  var _dayRaw = null;
  var _dayRawLoadedAt = 0;
  var _dayArribosTable = null;
  var _dayArribosLoadedAt = 0;
  var _dayIsAsesor = false;

  async function renderAvanceDia(selectedKey, selectedDateKey){
    var holder = document.getElementById("avanceDiaHolder"), hint = document.getElementById("avanceDiaHint");
    if(!holder || !_raw) return;
    var raw = _dayRaw || _raw, monthInfo = buildAvailableMonths(raw).find(function(m){ return m.key === selectedKey; });
    if(!monthInfo){ holder.innerHTML = ""; return; }
    var now = new Date(), selectedDate = selectedDateKey ? new Date(selectedDateKey + "T00:00:00") : now;
    var cutoffDate = new Date(selectedDate); cutoffDate.setDate(cutoffDate.getDate() - 1);
    var cutoffKey = dateKeyAv(cutoffDate);
    var totalDays = daysInMonth(monthInfo.date.getFullYear(), monthInfo.date.getMonth());
    var totalWorkingDays = workingDaysInMonthAv(monthInfo.date.getFullYear(), monthInfo.date.getMonth());
    var selectedIsCurrentDay = dateKeyAv(selectedDate) === dateKeyAv(now);
    var hoursOpen = isWorkingDayAv(selectedDate) ? (selectedIsCurrentDay ? currentOperatingHours() : OPERATING_HOURS) : 0;
    var stores = {}, ajustesPorPdv = {};
    try{
      var ajustesRes = await window.supabaseClient.from("cuota_ajustes").select("pdv, asesor_nombre, porcentaje").eq("mes", selectedKey);
      (ajustesRes.data || []).forEach(function(row){
        var pdvKey = normA(row.pdv); if(!ajustesPorPdv[pdvKey]) ajustesPorPdv[pdvKey] = {};
        ajustesPorPdv[pdvKey][normA(row.asesor_nombre)] = Number(row.porcentaje);
      });
    }catch(e){}
    function ensureStore(name){
      var key = normA(name); if(!stores[key]) stores[key] = { name:name, cuotas:{}, productos:{}, asesores:{} };
      return stores[key];
    }
    raw.cRows.forEach(function(r){
      var d = parseLooseDate(r[raw.cIdx.mes]); if(!d || monthKey(d) !== selectedKey) return;
      var name = (r[raw.cIdx.pdvs] || "").trim(); if(!name) return;
      var store = ensureStore(name), product = normA(r[raw.cIdx.producto]);
      store.cuotas[product] = (store.cuotas[product] || 0) + (parseFloat((r[raw.cIdx.cuota] || "").toString().replace(",",".")) || 0);
    });
    raw.vRows.forEach(function(r){
      var d = parseLooseDate(r[raw.vIdx.fecha]);
      if(!d || monthKey(d) !== selectedKey || !isWorkingDayAv(d) || !countConcreteSales(raw, r)) return;
      var storeName = (r[raw.vIdx.tienda] || "").trim(); if(!storeName) return;
      var store = ensureStore(storeName), advisorName = raw.vIdx.asesor === -1 ? "Sin asesor" : ((r[raw.vIdx.asesor] || "").trim() || "Sin asesor");
      var advisorKey = normA(advisorName);
      if(!store.asesores[advisorKey]) store.asesores[advisorKey] = { name:advisorName, productos:{} };
      var txn = normA(r[raw.vIdx.transaccion]), plan = raw.vIdx.plan === -1 ? "" : r[raw.vIdx.plan], modalidad = raw.vIdx.modalidad === -1 ? "" : r[raw.vIdx.modalidad];
      // Estas dos transacciones solo incrementan SS TOTAL de Avance Dia Link.
      // No se agregan a ninguna de las tablas de producto ni al Avance Link mensual.
      if(txn === "PORTA OPP MONO" || txn === "PORTA OPP LLAA CAPTURA"){
        [store, store.asesores[advisorKey]].forEach(function(target){
          if(!target.productos.sstotal_opp_extra) target.productos.sstotal_opp_extra = { venta:0, ventaDia:0 };
          if(dateKeyAv(d) <= cutoffKey) target.productos.sstotal_opp_extra.venta++;
          if(dateKeyAv(d) === dateKeyAv(selectedDate)) target.productos.sstotal_opp_extra.ventaDia++;
        });
      }
      CATEGORIES.forEach(function(cat){
        var match = cat.txns.some(function(t){ return normA(t) === txn; });
        if(!match || (cat.requiresPlan49 && !planFeeOk(plan)) || (cat.requiresModalidad && !modalidadOk(modalidad))) return;
        [store, store.asesores[advisorKey]].forEach(function(target){
          if(!target.productos[cat.id]) target.productos[cat.id] = { venta:0, ventaDia:0 };
          if(dateKeyAv(d) <= cutoffKey) target.productos[cat.id].venta++;
          if(dateKeyAv(d) === dateKeyAv(selectedDate)) target.productos[cat.id].ventaDia++;
        });
      });
    });
    // Arribos de la misma fuente publicada de la página Arribos. Solo se
    // muestran en SS TOTAL y corresponden a la fecha elegida.
    try{
      if(!_dayArribosTable || Date.now() - _dayArribosLoadedAt > DATA_CACHE_MS_AV){
        _dayArribosTable = parseCSVav(await fetchCsvText(ARRIBOS_CSV_URL));
        _dayArribosLoadedAt = Date.now();
      }
      var arribosTable = _dayArribosTable;
      var arribosHeaders = arribosTable[0] || [], arribosRows = arribosTable.slice(1);
      var arTienda = findCol(arribosHeaders,["Tienda"]), arAsesor = findCol(arribosHeaders,["Asesor"]), arFecha = findCol(arribosHeaders,["Fecha de Venta","Fecha"]);
      if(arTienda !== -1 && arAsesor !== -1 && arFecha !== -1) arribosRows.forEach(function(r){
        var date = parseLooseDate(r[arFecha]); if(!date || dateKeyAv(date) !== dateKeyAv(selectedDate)) return;
        var storeName = (r[arTienda] || "").trim(), advisorName = (r[arAsesor] || "").trim(); if(!storeName) return;
        var store = ensureStore(storeName); store.arribosDia = (store.arribosDia || 0) + 1;
        if(advisorName){
          var advisorKey = normA(advisorName);
          if(!store.asesores[advisorKey]) store.asesores[advisorKey] = { name:advisorName, productos:{} };
          store.asesores[advisorKey].arribosDia = (store.asesores[advisorKey].arribosDia || 0) + 1;
        }
      });
    }catch(e){ console.warn("No se pudieron cargar los arribos para Avance día.", e); }
    var diaAnterior = Math.max(0, selectedDate.getDate() - 1);
    var productViews = [{ id:"sstotal", label:"SS TOTAL", cuotaProductos:["PORTA OSS","PORTA OPP","VR BASE","VR CAPTURA"], salesIds:["oss","opp","vrbase","vrcaptura","sstotal_opp_extra"], isSsTotal:true }]
      .concat(CATEGORIES.map(function(cat){ return { id:cat.id, label:cat.label, cuotaProductos:[cat.cuotaProducto], salesIds:[cat.id], isSsTotal:false }; }));
    function quotaFor(store, product){ return product.cuotaProductos.reduce(function(total,key){ return total + (store.cuotas[normA(key)] || 0); },0); }
    function salesFor(target, product, field){ return product.salesIds.reduce(function(total,id){ return total + ((target.productos[id] || {})[field] || 0); },0); }
    function metric(cuotaMes, venta, ventaDia){
      var diasHastaAyer = Math.min(totalWorkingDays, workingDaysBeforeAv(selectedDate));
      var cuotaDia = cuotaMes / totalWorkingDays, cuota = cuotaDia * diasHastaAyer;
      var restante = Math.max(1, totalWorkingDays - diasHastaAyer);
      var expected = cuotaDia * (hoursOpen / OPERATING_HOURS);
      return { cuota:cuota, venta:venta, ventaDia:ventaDia, desfase:venta-cuota, cuotaDia:cuotaDia,
        cuotaDiaRecalculada:Math.max(0,(cuotaMes-venta)/restante), expectedNow:expected, hoursOpen:hoursOpen };
    }
    function rowsForProduct(product, index){
      var selectedStores = Object.keys(stores).filter(function(key){ return !_selectedDayPdvs.length || _selectedDayPdvs.indexOf(key) !== -1; }).sort(function(a,b){ return stores[a].name.localeCompare(stores[b].name,"es"); });
      var rows = selectedStores.map(function(key){
        var store = stores[key], advisorList = Object.keys(store.asesores).map(function(k){ return store.asesores[k]; }).sort(function(a,b){ return a.name.localeCompare(b.name,"es"); });
        var treeKey = index + "|" + key, storeMetric = metric(quotaFor(store,product), salesFor(store,product,"venta"), salesFor(store,product,"ventaDia"));
        var storeConversion = product.isSsTotal && (store.arribosDia || 0) > 0 ? salesFor(store,product,"ventaDia") / store.arribosDia : null;
        var rows = '<tr class="avance-day-store"><td><button type="button" class="avance-day-expand" data-day-toggle="store" data-day-key="' + escapeHtmlAv(treeKey) + '" aria-expanded="false">▶</button><strong>' + escapeHtmlAv(store.name) + '</strong></td>' + dayMetricCells(storeMetric) + (product.isSsTotal ? '<td>' + arribosIndicator(store.arribosDia || 0) + '</td><td>' + conversionIndicator(storeConversion) + '</td>' : '') + '</tr>';
        var active = advisorList.filter(function(a){ return (ajustesPorPdv[key] || {})[normA(a.name)] !== 0; }).length || 1;
        rows += advisorList.map(function(advisor){
          var pct = (ajustesPorPdv[key] || {})[normA(advisor.name)]; if(pct === undefined) pct = 100;
          var share = pct === 0 ? 0 : (pct / 100) / active;
          var advisorMetric = metric(quotaFor(store,product) * share, salesFor(advisor,product,"venta"), salesFor(advisor,product,"ventaDia"));
          var conversion = product.isSsTotal && (advisor.arribosDia || 0) > 0 ? salesFor(advisor,product,"ventaDia") / advisor.arribosDia : null;
          return '<tr class="avance-day-advisor" data-day-parent="' + escapeHtmlAv(treeKey) + '" hidden><td>↳ ' + escapeHtmlAv(advisor.name) + '<span class="avance-day-share">Cuota ' + pct + '%</span></td>' + dayMetricCells(advisorMetric) + (product.isSsTotal ? '<td>' + arribosIndicator(advisor.arribosDia || 0) + '</td><td>' + conversionIndicator(conversion) + '</td>' : '') + '</tr>';
        }).join("");
        return rows;
      }).join("");
      if(!selectedStores.length) return rows;
      var totalCuotaMes = 0, totalVenta = 0, totalVentaDia = 0, totalArribos = 0;
      selectedStores.forEach(function(key){
        var store = stores[key];
        totalCuotaMes += quotaFor(store, product);
        totalVenta += salesFor(store, product, "venta");
        totalVentaDia += salesFor(store, product, "ventaDia");
        totalArribos += store.arribosDia || 0;
      });
      var totalMetric = metric(totalCuotaMes, totalVenta, totalVentaDia);
      var totalConversion = product.isSsTotal && totalArribos > 0 ? totalVentaDia / totalArribos : null;
      return rows + '<tr class="avance-day-total"><td><strong>TOTAL</strong></td>' + dayMetricCells(totalMetric) + (product.isSsTotal ? '<td>' + arribosIndicator(totalArribos) + '</td><td>' + conversionIndicator(totalConversion) + '</td>' : '') + '</tr>';
    }
    holder.innerHTML = productViews.map(function(product,index){
      var extraHead = product.isSsTotal ? '<th>Arribos</th><th>Conversión</th>' : '';
      return '<section class="table-card avance-day-card" data-avance-day-product="' + escapeHtmlAv(product.id) + '"><div class="heading"><div><h2>' + escapeHtmlAv(product.label) + '</h2><span class="avance-sub">Avance por PDV y asesor · ' + monthLabel(monthInfo.date) + '</span></div><div class="avance-day-actions"><button type="button" class="avance-day-card-btn" data-avance-day-action="expand">Expandir</button><button type="button" class="avance-day-card-btn is-capture" data-avance-day-action="capture">Copiar captura</button><button type="button" class="avance-day-card-btn is-download" data-avance-day-action="excel">Descargar Excel</button></div></div><div class="table-scroll"><table class="avance-day-table' + (_dayIsAsesor ? ' avance-day-table-asesor' : '') + '"><thead><tr><th>PDV / Asesor</th><th>Cuota 1-' + diaAnterior + '</th><th>Venta 1-' + diaAnterior + '</th><th>Desfase</th><th>Cuota día</th><th>Cuota día recalculada</th><th>Venta día</th><th>Alcance</th><th>Proyección (und)</th><th>Proyección (%)</th>' + extraHead + '</tr></thead><tbody>' + (rowsForProduct(product,index) || '<tr><td colspan="12">No hay datos para este filtro.</td></tr>') + '</tbody></table></div></section>';
    }).join("");
    if(hint) hint.textContent = "Fecha de cálculo: " + selectedDate.toLocaleDateString("es-PE", { weekday:"long", day:"numeric", month:"long", year:"numeric" }) + ". Proyección basada en el horario 08:00–21:00. Se consideran " + totalWorkingDays + " días hábiles (lunes a sábado). Cuota Entel y venta Link.";
  }

  async function renderForMonth(selectedKey){
    var hint = document.getElementById("avanceHint");
    var storeHolder = document.getElementById("avanceStoreCardHolder");
    var asesoresHolder = document.getElementById("avanceAsesoresHolder");
    var profile = window.currentUserProfile;
    var raw = _raw;

    var monthsList = buildAvailableMonths(raw);
    var monthInfo = monthsList.find(function(m){ return m.key === selectedKey; });
    if(!monthInfo){
      hint.textContent = "No hay datos para ese mes.";
      storeHolder.innerHTML = ""; asesoresHolder.innerHTML = "";
      return;
    }
    var monthDate = monthInfo.date;
    var totalDias = daysInMonth(monthDate.getFullYear(), monthDate.getMonth());
    var today = new Date();
    var diasTranscurridos = (today.getFullYear() === monthDate.getFullYear() && today.getMonth() === monthDate.getMonth())
      ? today.getDate() : totalDias;

    var myPdvNorm = normA(_selectedPdv || profile.pdv);

    // Cuotas de este PDV para el mes seleccionado
    var storeCuotasForMonth = {};
    var storeNameByNorm = {};
    raw.cRows.forEach(function(r){
      var d = parseLooseDate(r[raw.cIdx.mes]);
      if(!d || monthKey(d) !== selectedKey) return;
      var pdvName = (r[raw.cIdx.pdvs] || "").trim();
      if(!pdvName) return;
      var norm = normA(pdvName);
      storeNameByNorm[norm] = pdvName;
      if(norm !== myPdvNorm) return;
      var prodNorm = normA(r[raw.cIdx.producto]);
      var cuotaVal = parseFloat((r[raw.cIdx.cuota] || "").toString().replace(",", ".")) || 0;
      storeCuotasForMonth[prodNorm] = cuotaVal;
    });

    // Ventas de este PDV para el mes seleccionado
    var rowsThisStoreMonth = raw.vRows.filter(function(r){
      var d = parseLooseDate(r[raw.vIdx.fecha]);
      if(!d || monthKey(d) !== selectedKey) return false;
      var tienda = (r[raw.vIdx.tienda] || "").trim();
      return tienda && normA(tienda) === myPdvNorm;
    });

    // Asesores que "subieron" al menos una venta a este PDV este mes (sin importar si se concretó)
    var advisorNamesSet = {};
    rowsThisStoreMonth.forEach(function(r){
      var name = (raw.vIdx.asesor !== -1) ? (r[raw.vIdx.asesor] || "").trim() : "";
      if(name) advisorNamesSet[normA(name)] = name; // guarda el nombre "bonito" tal como viene
    });
    var advisorNames = Object.keys(advisorNamesSet).sort().map(function(k){ return advisorNamesSet[k]; });

    // Tally de ventas concretadas por categoría (tienda y por asesor)
    var countsByStore = {};
    var countsByAdvisor = {};
    rowsThisStoreMonth.forEach(function(r){
      if(raw.vIdx.concreto !== -1 && normA(r[raw.vIdx.concreto]) !== "SI") return;
      var txn = normA(r[raw.vIdx.transaccion]);
      var advisor = (raw.vIdx.asesor !== -1) ? (r[raw.vIdx.asesor] || "").trim() : "";
      var advisorNorm = normA(advisor);
      var plan = (raw.vIdx.plan !== -1) ? r[raw.vIdx.plan] : "";
      var modalidad = (raw.vIdx.modalidad !== -1) ? r[raw.vIdx.modalidad] : "";

      CATEGORIES.forEach(function(cat){
        var match = cat.txns.some(function(t){ return normA(t) === txn; });
        if(!match) return;
        if(cat.requiresPlan49 && !planFeeOk(plan)) return;
        if(cat.requiresModalidad && !modalidadOk(modalidad)) return;
        countsByStore[cat.id] = (countsByStore[cat.id] || 0) + 1;
        if(advisorNorm){
          if(!countsByAdvisor[advisorNorm]) countsByAdvisor[advisorNorm] = {};
          countsByAdvisor[advisorNorm][cat.id] = (countsByAdvisor[advisorNorm][cat.id] || 0) + 1;
        }
      });
    });

    // % de reparto guardados para este PDV + mes
    var ajustes = {};
    try{
      var ajRes = await window.supabaseClient
        .from("cuota_ajustes").select("asesor_nombre, porcentaje")
        .eq("pdv", _selectedPdv || profile.pdv).eq("mes", selectedKey);
      (ajRes.data || []).forEach(function(row){ ajustes[normA(row.asesor_nombre)] = Number(row.porcentaje); });
    }catch(e){ /* si falla, todos quedan en 100% por defecto */ }

    // La cuota de tienda se reparte solo entre los asesores que "cuentan" para el
    // reparto: los que tienen venta subida y NO están en 0%. Un asesor en 0% no
    // recibe cuota propia, pero su venta sigue sumando al total de tienda, y su
    // parte de la cuota pasa a repartirse entre el resto (se divide entre menos gente).
    var N = advisorNames.filter(function(name){
      var pct = ajustes[normA(name)];
      return pct !== 0;
    }).length || 1;

    _ctx = {
      myPdvNorm: myPdvNorm,
      storeCuotasForMonth: storeCuotasForMonth,
      totalDias: totalDias,
      diasTranscurridos: diasTranscurridos,
      countsByAdvisor: countsByAdvisor,
      advisorNames: advisorNames,
      N: N,
      ajustes: ajustes,
      pdvDisplay: _selectedPdv || profile.pdv,
      mesKey: selectedKey,
      monthDate: monthDate
    };

    var storeRows = buildRowsForCuotaSet(storeCuotasForMonth, countsByStore, totalDias, diasTranscurridos);
    storeHolder.innerHTML =
      '<section class="table-card">' +
        '<div class="heading avance-card-title">' +
          '<div><h2>' + escapeHtmlAv(storeNameByNorm[myPdvNorm] || _selectedPdv || profile.pdv) + '</h2>' +
          '<span class="avance-sub">Avance de tienda · ' + monthLabel(monthDate) + ' · ' + advisorNames.length + ' asesor(es) con ventas' +
            (N !== advisorNames.length ? ' · cuota repartida entre ' + N : '') + '</span></div>' +
        '</div>' +
        tableShell(renderTableRows(storeRows)) +
      '</section>';

    if(advisorNames.length === 0){
      asesoresHolder.innerHTML = '<p style="margin-top:16px; color:var(--ink-soft); font-size:13px;">' +
        'Nadie ha subido ventas a este PDV en ' + monthLabel(monthDate) + ' todavía.</p>';
    }else{
      asesoresHolder.innerHTML = advisorNames.map(renderAdvisorCard).join("");
    }

    hint.textContent = "Actualizado a las " + new Date().toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit"}) +
      " — " + monthLabel(monthDate) + " · Día " + diasTranscurridos + " de " + totalDias;
    var ordersModal = document.getElementById("avanceOrdersModal");
    if(ordersModal && !ordersModal.hidden) renderConsideredOrders();
    if(_dayViewOpen) await renderDayAdvance(selectedKey);
  }

  window.loadAvance = async function(){
    var hint = document.getElementById("avanceHint");
    var storeHolder = document.getElementById("avanceStoreCardHolder");
    var asesoresHolder = document.getElementById("avanceAsesoresHolder");
    var pdvSelect = document.getElementById("avancePdvSelect");
    var profile = window.currentUserProfile;

    if(!profile){
      hint.textContent = "No se pudo identificar tu usuario.";
      return;
    }

    // Averiguar el cargo (consulta aparte, sin tocar el resto del código de login).
    var cargo = "";
    try{
      var cargoRes = await window.supabaseClient
        .from("profiles").select("cargo").eq("email", profile.email).maybeSingle();
      cargo = (cargoRes.data && cargoRes.data.cargo) || "";
    }catch(e){ cargo = ""; }
    _isAsesor = normA(cargo) === "ASESOR" || normA(cargo) === "";
    _canEditAjustes = normA(cargo) === "SUPERVISOR";

    if(_isAsesor && !profile.pdv){
      hint.textContent = "Tu usuario no tiene un PDV asignado todavía. Pide que te agreguen la columna pdv en profiles (Supabase).";
      storeHolder.innerHTML = ""; asesoresHolder.innerHTML = "";
      pdvSelect.style.display = "none";
      return;
    }

    hint.textContent = "Cargando avance…";
    try{
      if(!_raw || Date.now() - _rawLoadedAt > DATA_CACHE_MS_AV){
        _raw = await loadRawData();
        _rawLoadedAt = Date.now();
      }
      _storesDirectory = buildStoresDirectory(_raw);

      if(_isAsesor){
        pdvSelect.style.display = "none";
        _selectedPdv = profile.pdv;
      }else{
        pdvSelect.style.display = "";
        var preferido = profile.pdv && _storesDirectory.some(function(s){ return s.norm === normA(profile.pdv); })
          ? profile.pdv
          : (_storesDirectory[0] ? _storesDirectory[0].name : null);
        if(!preferido){
          hint.textContent = "No se encontraron tiendas en el archivo de cuotas.";
          storeHolder.innerHTML = ""; asesoresHolder.innerHTML = "";
          return;
        }
        _selectedPdv = preferido;
        populatePdvSelect(_storesDirectory, normA(_selectedPdv));
      }

      var monthsList = buildAvailableMonths(_raw);
      if(monthsList.length === 0){
        hint.textContent = "No se encontraron fechas válidas en los archivos.";
        return;
      }
      var todayKey = monthKey(new Date());
      var defaultKey = monthsList.some(function(m){ return m.key === todayKey; }) ? todayKey : monthsList[0].key;
      populateMonthSelect(monthsList, defaultKey);
      await renderForMonth(defaultKey);
    }catch(e){
      hint.textContent = "No se pudo cargar el avance. Verifica tu conexión e intenta de nuevo.";
      console.error(e);
    }
  };

  window.loadAvanceDia = async function(){
    var hint = document.getElementById("avanceDiaHint"), filter = document.getElementById("avanceDiaPdvFilter"), monthSelect = document.getElementById("avanceDiaMonthSelect"), dateSelect = document.getElementById("avanceDiaDate");
    var profile = window.currentUserProfile;
    if(!profile){ if(hint) hint.textContent = "No se pudo identificar tu usuario."; return; }
    if(hint) hint.textContent = "Cargando avance del día…";
    try{
      if(!_raw || Date.now() - _rawLoadedAt > DATA_CACHE_MS_AV){
        _raw = await loadRawData();
        _rawLoadedAt = Date.now();
      }
      if(!_dayRaw || Date.now() - _dayRawLoadedAt > DATA_CACHE_MS_AV || _dayRaw.vRows !== _raw.vRows){
        var cuotasDiaTable = parseCSVav(await fetchCsvText(CUOTAS_DIA_CSV_URL));
        var cuotasDiaHeaders = cuotasDiaTable[0] || [], cuotasDiaRows = cuotasDiaTable.slice(1);
        var cuotasDiaIdx = { mes:findCol(cuotasDiaHeaders,["MES"]), pdvs:findCol(cuotasDiaHeaders,["PDVS"]), producto:findCol(cuotasDiaHeaders,["PRODUCTO"]), cuota:findCol(cuotasDiaHeaders,["CUOTA"]) };
        if(cuotasDiaIdx.pdvs === -1 || cuotasDiaIdx.producto === -1 || cuotasDiaIdx.cuota === -1) throw new Error("La hoja de cuotas de Avance Dia Link no tiene las columnas esperadas.");
        _dayRaw = { cHeaders:cuotasDiaHeaders, cRows:cuotasDiaRows, cIdx:cuotasDiaIdx, vHeaders:_raw.vHeaders, vRows:_raw.vRows, vIdx:_raw.vIdx };
        _dayRawLoadedAt = Date.now();
      }
      _storesDirectory = buildStoresDirectory(_dayRaw);
      var isAsesor = normA(profile.cargo) === "ASESOR" || !profile.cargo;
      _dayIsAsesor = isAsesor;
      if(isAsesor){
        _selectedDayPdvs = profile.pdv ? [normA(profile.pdv)] : [];
        if(filter) filter.style.display = "none";
      }else{
        _selectedDayPdvs = [];
        if(filter){ filter.style.display = ""; populatePdvFilterForDay(_storesDirectory); }
      }
      var months = buildAvailableMonths(_dayRaw), currentKey = monthKey(new Date());
      var selectedKey = months.some(function(m){ return m.key === currentKey; }) ? currentKey : (months[0] || {}).key;
      if(!selectedKey) throw new Error("No hay meses disponibles.");
      if(monthSelect){
        monthSelect.innerHTML = months.map(function(m){ return '<option value="' + m.key + '">' + escapeHtmlAv(monthLabel(m.date)) + '</option>'; }).join("");
        monthSelect.value = selectedKey;
      }
      if(dateSelect){ dateSelect.value = dateKeyAv(new Date()); dateSelect.min = selectedKey + "-01"; dateSelect.max = selectedKey + "-" + String(daysInMonth(months.find(function(m){ return m.key === selectedKey; }).date.getFullYear(), months.find(function(m){ return m.key === selectedKey; }).date.getMonth())).padStart(2,"0"); }
      await renderAvanceDia(selectedKey, dateSelect && dateSelect.value);
    }catch(e){ if(hint) hint.textContent = "No se pudo cargar el avance del día. Verifica tu conexión e intenta nuevamente."; console.error(e); }
  };

  function populatePdvFilterForDay(stores){
    var menu = document.getElementById("avanceDiaPdvMenu"); if(!menu) return;
    menu.innerHTML = '<label class="avance-dia-pdv-all"><input type="checkbox" data-day-pdv-all checked> Todos los PDV</label>' + stores.map(function(store){
      return '<label><input type="checkbox" data-day-pdv="' + escapeHtmlAv(store.norm) + '"> ' + escapeHtmlAv(store.name) + '</label>';
    }).join("");
  }

  document.addEventListener("DOMContentLoaded", function(){
    var monthSelect = document.getElementById("avanceMonthSelect");
    if(monthSelect){
      monthSelect.addEventListener("change", function(){
        if(_raw) renderForMonth(monthSelect.value);
      });
    }
    var pdvSelect = document.getElementById("avancePdvSelect");
    if(pdvSelect){
      pdvSelect.addEventListener("change", function(){
        if(!_raw) return;
        _selectedPdv = pdvSelect.value;
        var monthSel = document.getElementById("avanceMonthSelect");
        if(monthSel && monthSel.value) renderForMonth(monthSel.value);
      });
    }
    var ordersModal = document.getElementById("avanceOrdersModal");
    var ordersButton = document.getElementById("avanceOrdersBtn");
    var ordersClose = document.getElementById("avanceOrdersClose");
    var ordersAdvisorFilter = document.getElementById("avanceOrdersAdvisorFilter");
    var ordersNotCounted = document.getElementById("avanceOrdersNotCounted");
    function closeConsideredOrders(){
      if(!ordersModal) return;
      ordersModal.hidden = true;
      if(ordersButton) ordersButton.focus();
    }
    if(ordersButton && ordersModal){
      ordersButton.addEventListener("click", function(){
        renderConsideredOrders();
        ordersModal.hidden = false;
        if(ordersClose) ordersClose.focus();
      });
    }
    if(ordersClose) ordersClose.addEventListener("click", closeConsideredOrders);
    if(ordersAdvisorFilter) ordersAdvisorFilter.addEventListener("change", renderConsideredOrders);
    if(ordersNotCounted) ordersNotCounted.addEventListener("click", function(){
      var active = ordersNotCounted.getAttribute("aria-pressed") !== "true";
      ordersNotCounted.setAttribute("aria-pressed", String(active));
      ordersNotCounted.classList.toggle("is-active", active);
      renderConsideredOrders();
    });
    if(ordersModal){
      ordersModal.addEventListener("click", function(event){ if(event.target === ordersModal) closeConsideredOrders(); });
      document.addEventListener("keydown", function(event){ if(event.key === "Escape" && !ordersModal.hidden) closeConsideredOrders(); });
    }
    var dayPdvButton = document.getElementById("avanceDiaPdvButton"), dayPdvMenu = document.getElementById("avanceDiaPdvMenu"), dayMonthSelect = document.getElementById("avanceDiaMonthSelect"), dayDateSelect = document.getElementById("avanceDiaDate");
    function rerenderAvanceDia(){
      if(!(_dayRaw || _raw) || !dayMonthSelect || !dayMonthSelect.value) return;
      var chosen = buildAvailableMonths(_dayRaw || _raw).find(function(m){ return m.key === dayMonthSelect.value; });
      if(dayDateSelect && chosen){
        dayDateSelect.min = chosen.key + "-01";
        dayDateSelect.max = chosen.key + "-" + String(daysInMonth(chosen.date.getFullYear(),chosen.date.getMonth())).padStart(2,"0");
        if(!dayDateSelect.value || dayDateSelect.value.slice(0,7) !== chosen.key) dayDateSelect.value = chosen.key + "-01";
      }
      renderAvanceDia(dayMonthSelect.value, dayDateSelect && dayDateSelect.value);
    }
    if(dayPdvButton && dayPdvMenu){
      dayPdvButton.addEventListener("click", function(){
        var open = dayPdvMenu.hidden; dayPdvMenu.hidden = !open; dayPdvButton.setAttribute("aria-expanded", String(open));
      });
      dayPdvMenu.addEventListener("change", function(e){
        var all = dayPdvMenu.querySelector("[data-day-pdv-all]");
        var checks = Array.prototype.slice.call(dayPdvMenu.querySelectorAll("[data-day-pdv]"));
        if(e.target.matches("[data-day-pdv-all]")) checks.forEach(function(check){ check.checked = false; });
        else if(all) all.checked = checks.every(function(check){ return !check.checked; });
        _selectedDayPdvs = checks.filter(function(check){ return check.checked; }).map(function(check){ return check.getAttribute("data-day-pdv"); });
        dayPdvButton.textContent = _selectedDayPdvs.length ? "PDV · " + _selectedDayPdvs.length + " seleccionado" + (_selectedDayPdvs.length === 1 ? "" : "s") : "PDV · Todos";
        rerenderAvanceDia();
      });
      document.addEventListener("click", function(e){ if(!e.target.closest("#avanceDiaPdvFilter")){ dayPdvMenu.hidden = true; dayPdvButton.setAttribute("aria-expanded","false"); } });
    }
    if(dayMonthSelect) dayMonthSelect.addEventListener("change", rerenderAvanceDia);
    if(dayDateSelect) dayDateSelect.addEventListener("change", rerenderAvanceDia);
    var dayButton = document.getElementById("avanceDayBtn");
    if(dayButton){
      dayButton.addEventListener("click", async function(){
        _dayViewOpen = !_dayViewOpen;
        dayButton.setAttribute("aria-pressed", String(_dayViewOpen));
        dayButton.classList.toggle("is-active", _dayViewOpen);
        dayButton.textContent = _dayViewOpen ? "Ocultar avance día" : "Avance día";
        var holder = document.getElementById("avanceDayHolder");
        if(holder) holder.hidden = !_dayViewOpen;
        if(_dayViewOpen && _raw){
          var monthSel = document.getElementById("avanceMonthSelect");
          await renderDayAdvance(monthSel && monthSel.value);
        }
      });
    }
    var html2CanvasLoader = null;
    function loadHtml2Canvas(){
      if(window.html2canvas) return Promise.resolve(window.html2canvas);
      if(html2CanvasLoader) return html2CanvasLoader;
      html2CanvasLoader = new Promise(function(resolve,reject){
        var script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
        script.onload = function(){ resolve(window.html2canvas); };
        script.onerror = function(){ reject(new Error("No se pudo cargar el generador de capturas.")); };
        document.head.appendChild(script);
      });
      return html2CanvasLoader;
    }
    async function copyDayTableCapture(card, button){
      var originalText = button.textContent;
      button.disabled = true; button.textContent = "Generando…";
      var stage = document.createElement("div"), clone = card.cloneNode(true);
      try{
        clone.querySelectorAll(".avance-day-actions").forEach(function(actions){ actions.remove(); });
        clone.querySelectorAll(".avance-day-table th:first-child,.avance-day-table td:first-child").forEach(function(cell){ cell.style.position = "static"; cell.style.boxShadow = "none"; });
        var scroll = clone.querySelector(".table-scroll"), table = clone.querySelector("table");
        if(scroll){ scroll.style.overflow = "visible"; scroll.style.padding = "0"; }
        if(table){ table.style.width = "max-content"; table.style.minWidth = "0"; }
        stage.style.cssText = "position:fixed;left:-100000px;top:0;z-index:-1;background:#fff;padding:18px;width:max-content;max-width:none;";
        stage.appendChild(clone); document.body.appendChild(stage);
        var html2canvas = await loadHtml2Canvas();
        var canvas = await html2canvas(clone, { backgroundColor:"#ffffff", scale:2, useCORS:true, logging:false, width:clone.scrollWidth, height:clone.scrollHeight });
        var blob = await new Promise(function(resolve){ canvas.toBlob(resolve,"image/png"); });
        if(!blob) throw new Error("No se pudo crear la imagen.");
        if(navigator.clipboard && window.ClipboardItem){
          await navigator.clipboard.write([new ClipboardItem({"image/png":blob})]);
          button.textContent = "¡Copiada!";
        }else{
          var link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "captura-avance-dia.png"; document.body.appendChild(link); link.click(); link.remove(); setTimeout(function(){ URL.revokeObjectURL(link.href); },0);
          button.textContent = "Imagen descargada";
        }
      }catch(error){
        console.error(error);
        alert("No se pudo copiar la captura. Prueba nuevamente desde la versión publicada con HTTPS.");
      }finally{
        if(stage.parentNode) stage.remove();
        setTimeout(function(){ button.disabled = false; button.textContent = originalText; }, 1200);
      }
    }
    document.addEventListener("click", function(e){
      var actionButton = e.target.closest("[data-avance-day-action]");
      if(!actionButton) return;
      var card = actionButton.closest(".avance-day-card");
      if(!card) return;
      var action = actionButton.getAttribute("data-avance-day-action");
      var table = card.querySelector("table");
      if(!table) return;
      if(action === "expand"){
        var open = actionButton.getAttribute("data-expanded") !== "true";
        card.querySelectorAll(".avance-day-expand[data-day-toggle='store']").forEach(function(toggle){
          var key = toggle.getAttribute("data-day-key");
          toggle.setAttribute("aria-expanded", String(open)); toggle.textContent = open ? "▼" : "▶";
          card.querySelectorAll('[data-day-parent="' + key + '"]').forEach(function(row){ row.hidden = !open; });
        });
        actionButton.setAttribute("data-expanded", String(open));
        actionButton.textContent = open ? "Contraer" : "Expandir";
        return;
      }
      if(action === "capture"){
        copyDayTableCapture(card, actionButton);
        return;
      }
      if(action === "excel"){
        var copy = table.cloneNode(true);
        copy.querySelectorAll("tr[hidden]").forEach(function(row){ row.hidden = false; row.removeAttribute("hidden"); });
        copy.querySelectorAll("button").forEach(function(button){ var label = document.createElement("span"); label.textContent = button.textContent; button.replaceWith(label); });
        var html = '<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt}th,td{border:1px solid #cbd5e1;padding:7px;text-align:center}th{background:#0e1aa1;color:#fff;font-weight:bold}td:first-child{text-align:left}tr.avance-day-total td{background:#0e1aa1;color:#fff;font-weight:bold}</style></head><body><h2>' + (card.querySelector("h2") || {}).textContent + '</h2>' + copy.outerHTML + '</body></html>';
        var blob = new Blob(["\ufeff", html], { type:"application/vnd.ms-excel;charset=utf-8" });
        var link = document.createElement("a"), slug = (card.getAttribute("data-avance-day-product") || "avance-dia").replace(/[^a-z0-9]+/gi,"-").toLowerCase();
        link.href = URL.createObjectURL(blob); link.download = "avance-dia-link-" + slug + ".xls"; document.body.appendChild(link); link.click(); link.remove(); setTimeout(function(){ URL.revokeObjectURL(link.href); }, 0);
      }
    });
    document.addEventListener("click", function(e){
      var toggle = e.target.closest(".avance-day-expand");
      if(!toggle) return;
      var type = toggle.getAttribute("data-day-toggle"), key = toggle.getAttribute("data-day-key");
      var selector = type === "store" ? '[data-day-parent="' + key + '"]' : '[data-day-product-parent="' + key + '"]';
      var rows = document.querySelectorAll(selector), open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "▼" : "▶";
      rows.forEach(function(row){ row.hidden = !open; });
      if(!open && type === "store"){
        rows.forEach(function(row){
          var advisorKey = row.querySelector(".avance-day-expand[data-day-toggle='advisor']");
          if(advisorKey){
            var advisorRows = document.querySelectorAll('[data-day-product-parent="' + advisorKey.getAttribute("data-day-key") + '"]');
            advisorRows.forEach(function(productRow){ productRow.hidden = true; });
            advisorKey.setAttribute("aria-expanded", "false"); advisorKey.textContent = "▶";
          }
        });
      }
    });
  });
})();
