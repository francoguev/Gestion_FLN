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
      _raw = await loadRawData();
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
  });
})();
