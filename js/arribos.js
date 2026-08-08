(function(){
  var ARRIBOS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSKUPtQOobapucdj6Izz7ZO2BT20Gws-RbXzeSxo733C7EZHOgscVXx7BDj_2JghU8PeNMvlN6Jrqb3/pub?gid=0&single=true&output=csv";

  var _arRows = [];          // filas crudas parseadas de la hoja
  var _arRowsLoadedAt = 0;
  var DATA_CACHE_MS_AR = 3 * 60 * 1000;
  var _arIsAsesor = false;
  var _arPdv = "";
  var _arMonthsList = [];

  function normAr(s){
    return (s || "").toString().trim().toUpperCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function escapeHtmlAr(s){
    return (s || "").toString().replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  function parseCSVAr(text){
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

  function findColAr(headers, name){
    var normHeaders = headers.map(normAr);
    return normHeaders.indexOf(normAr(name));
  }

  async function loadRawArribos(){
    var sep = ARRIBOS_CSV_URL.indexOf("?") === -1 ? "?" : "&";
    var res = await fetch(ARRIBOS_CSV_URL + sep + "_=" + Date.now());
    if(!res.ok) throw new Error("HTTP " + res.status);
    var text = await res.text();
    var table = parseCSVAr(text);
    if(table.length < 2) return [];
    var headers = table[0];
    var rows = table.slice(1);

    var idx = {
      tienda: findColAr(headers, "Tienda"),
      asesor: findColAr(headers, "Asesor"),
      fecha: findColAr(headers, "Fecha de Venta"),
      concretada: findColAr(headers, "¿Se concretó la Venta?"),
      motivo: findColAr(headers, "Detalla el motivo de VENTA NO CONCRETADA")
    };
    if(idx.tienda === -1 || idx.asesor === -1 || idx.fecha === -1){
      throw new Error("No se encontraron las columnas Tienda/Asesor/Fecha de Venta en la hoja.");
    }

    return rows.map(function(r){
      var fecha = (idx.fecha !== -1 ? r[idx.fecha] : "") || "";
      fecha = fecha.trim().slice(0, 10); // YYYY-MM-DD
      return {
        tienda: (idx.tienda !== -1 ? r[idx.tienda] : "").trim(),
        asesor: (idx.asesor !== -1 ? r[idx.asesor] : "").trim(),
        fecha: fecha,
        concretada: normAr(idx.concretada !== -1 ? r[idx.concretada] : "") === "SI",
        motivo: (idx.motivo !== -1 ? r[idx.motivo] : "").trim()
      };
    }).filter(function(it){
      return it.tienda && it.asesor && /^\d{4}-\d{2}-\d{2}$/.test(it.fecha);
    });
  }

  function monthKeyAr(dateStr){ return dateStr.slice(0, 7); } // YYYY-MM

  var MES_NOMBRES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  function monthLabelAr(key){
    var parts = key.split("-");
    var y = parts[0], m = parseInt(parts[1], 10);
    return MES_NOMBRES[m - 1] + " " + y;
  }

  function buildAvailableMonthsAr(rows){
    var set = {};
    rows.forEach(function(r){ set[monthKeyAr(r.fecha)] = true; });
    return Object.keys(set).sort().reverse().map(function(k){ return { key:k, label: monthLabelAr(k) }; });
  }

  function daysInMonthAr(key){
    var parts = key.split("-");
    var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
    return new Date(y, m, 0).getDate();
  }

  function maxDayForMonthAr(key){
    var todayKey = monthKeyAr(new Date().toISOString().slice(0,10));
    if(key === todayKey) return new Date().getDate();
    return daysInMonthAr(key);
  }

  function populateArribosMonthSelect(monthsList, selectedKey){
    var sel = document.getElementById("arribosMonthSelect");
    if(!sel) return;
    sel.innerHTML = monthsList.map(function(m){
      return '<option value="' + m.key + '">' + m.label + '</option>';
    }).join("");
    sel.value = selectedKey;
  }

  function buildStoreData(rowsForMonth, maxDay){
    var byStore = {};
    rowsForMonth.forEach(function(r){
      var day = parseInt(r.fecha.slice(8, 10), 10);
      if(!day || day > maxDay) return;
      if(!byStore[r.tienda]){
        byStore[r.tienda] = { total:0, byDay:{}, asesores:{} };
      }
      var store = byStore[r.tienda];
      store.total++;
      store.byDay[day] = (store.byDay[day] || 0) + 1;
      if(!store.asesores[r.asesor]){
        store.asesores[r.asesor] = { total:0, byDay:{} };
      }
      var ases = store.asesores[r.asesor];
      ases.total++;
      ases.byDay[day] = (ases.byDay[day] || 0) + 1;
    });
    return byStore;
  }

  function dayCellHtml(count){
    if(!count) return '<td class="arribos-zero">—</td>';
    return '<td>' + count + '</td>';
  }

  function rowCellsHtml(byDay, days, total){
    return days.map(function(d){ return dayCellHtml(byDay[d] || 0); }).join("") +
      '<td class="arribos-total-col">' + total + '</td>';
  }

  function setArribosTreeExpanded(expand){
    var holder = document.getElementById("arribosStoresHolder");
    if(!holder) return;
    holder.querySelectorAll(".arribos-tree-toggle").forEach(function(btn){
      var storeIdx = btn.getAttribute("data-store");
      var storeRow = holder.querySelector('tr.arribos-row-store[data-store="' + storeIdx + '"]');
      var children = holder.querySelectorAll('tr.arribos-row-asesor[data-parent="' + storeIdx + '"]');
      btn.textContent = expand ? "▼" : "▶";
      if(storeRow) storeRow.classList.toggle("is-expanded", expand);
      children.forEach(function(row){ row.style.display = expand ? "" : "none"; });
    });
    var expandBtn = document.getElementById("arribosExpandBtn");
    if(expandBtn){
      expandBtn.disabled = holder.querySelectorAll(".arribos-tree-toggle").length === 0;
      expandBtn.textContent = expand ? "Contraer" : "Expandir";
      expandBtn.setAttribute("aria-expanded", expand ? "true" : "false");
    }
  }

  function renderArribosTree(byStore, maxDay, expandFirstOnly){
    var holder = document.getElementById("arribosStoresHolder");
    if(!holder) return;
    var storeNames = Object.keys(byStore).sort(function(a,b){ return a.localeCompare(b, "es"); });
    if(!storeNames.length){
      holder.innerHTML = '<p class="hint">No hay arribos registrados para este mes.</p>';
      return;
    }

    var days = [];
    for(var d=1; d<=maxDay; d++) days.push(d);
    var theadDays = days.map(function(dd){ return '<th>' + dd + '</th>'; }).join("");
    var head = '<thead><tr><th class="arribos-sticky-col">Tienda / Asesor</th>' + theadDays + '<th class="arribos-total-col">Total</th></tr></thead>';

    var grandByDay = {};
    var grandTotal = 0;

    var bodyRows = storeNames.map(function(name, i){
      var s = byStore[name];
      grandTotal += s.total;
      days.forEach(function(dd){ grandByDay[dd] = (grandByDay[dd] || 0) + (s.byDay[dd] || 0); });

      var expanded = expandFirstOnly ? (i === 0) : false;
      var storeRow = '<tr class="arribos-row-store' + (expanded ? " is-expanded" : "") + '" data-store="' + i + '">' +
        '<td class="arribos-sticky-col"><button type="button" class="arribos-tree-toggle" data-store="' + i + '">' +
          (expanded ? "▼" : "▶") + '</button><span class="arribos-name-truncate" title="' + escapeHtmlAr(name) + '">' +
          escapeHtmlAr(name) + '</span></td>' +
        rowCellsHtml(s.byDay, days, s.total) +
      '</tr>';

      var asesorNames = Object.keys(s.asesores).sort(function(a,b){ return a.localeCompare(b, "es"); });
      var asesorRows = asesorNames.map(function(aname){
        var a = s.asesores[aname];
        return '<tr class="arribos-row-asesor" data-parent="' + i + '"' + (expanded ? "" : ' style="display:none;"') + '>' +
          '<td class="arribos-sticky-col arribos-asesor-cell"><span class="arribos-name-truncate" title="' + escapeHtmlAr(aname) + '">' +
          escapeHtmlAr(aname) + '</span></td>' +
          rowCellsHtml(a.byDay, days, a.total) +
        '</tr>';
      }).join("");

      return storeRow + asesorRows;
    }).join("");

    var totalRow = '<tr class="arribos-total-row"><td class="arribos-sticky-col">TOTAL</td>' +
      rowCellsHtml(grandByDay, days, grandTotal) + '</tr>';

    holder.innerHTML = '<div class="table-scroll"><table class="arribos-table">' + head +
      '<tbody>' + bodyRows + totalRow + '</tbody></table></div>';

    setArribosTreeExpanded(expandFirstOnly);

    holder.querySelectorAll(".arribos-tree-toggle").forEach(function(btn){
      btn.addEventListener("click", function(e){
        e.stopPropagation();
        var storeIdx = btn.getAttribute("data-store");
        var storeRow = holder.querySelector('tr.arribos-row-store[data-store="' + storeIdx + '"]');
        var children = holder.querySelectorAll('tr.arribos-row-asesor[data-parent="' + storeIdx + '"]');
        var willExpand = btn.textContent.trim() === "▶";
        btn.textContent = willExpand ? "▼" : "▶";
        if(storeRow) storeRow.classList.toggle("is-expanded", willExpand);
        children.forEach(function(row){ row.style.display = willExpand ? "" : "none"; });
        var allExpanded = Array.prototype.every.call(holder.querySelectorAll(".arribos-tree-toggle"), function(toggle){
          return toggle.textContent.trim() === "▼";
        });
        var expandBtn = document.getElementById("arribosExpandBtn");
        if(expandBtn){
          expandBtn.textContent = allExpanded ? "Contraer" : "Expandir";
          expandBtn.setAttribute("aria-expanded", allExpanded ? "true" : "false");
        }
      });
    });
  }

  function todayDateAr(){
    var now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2,"0") + "-" + String(now.getDate()).padStart(2,"0");
  }

  function dayLabelAr(dateKey){
    var date = new Date(dateKey + "T12:00:00");
    return date.toLocaleDateString("es-PE", { day:"2-digit", month:"short" }).replace(".", "");
  }

  function populateArribosSegmentadoresLegacy(scopedRows){
    var tiendaSelect = document.getElementById("arribosFiltroTienda");
    var asesorSelect = document.getElementById("arribosFiltroAsesor");
    if(!tiendaSelect || !asesorSelect) return;

    var tiendaVal = tiendaSelect.value;
    var asesorVal = asesorSelect.value;

    var tiendas = {}, asesores = {};
    scopedRows.forEach(function(r){
      tiendas[r.tienda] = true;
      asesores[r.asesor] = true;
    });
    var tiendaKeys = Object.keys(tiendas).sort(function(a,b){ return a.localeCompare(b, "es"); });
    var asesorKeys = Object.keys(asesores).sort(function(a,b){ return a.localeCompare(b, "es"); });

    tiendaSelect.innerHTML = '<option value="">TIENDA · Todas</option>' +
      tiendaKeys.map(function(t){ return '<option value="' + escapeHtmlAr(t) + '">' + escapeHtmlAr(t) + '</option>'; }).join("");
    asesorSelect.innerHTML = '<option value="">ASESOR · Todos</option>' +
      asesorKeys.map(function(a){ return '<option value="' + escapeHtmlAr(a) + '">' + escapeHtmlAr(a) + '</option>'; }).join("");

    // conserva la selección previa si sigue siendo válida
    if(tiendaKeys.indexOf(tiendaVal) !== -1) tiendaSelect.value = tiendaVal;
    if(asesorKeys.indexOf(asesorVal) !== -1) asesorSelect.value = asesorVal;
  }

  function populateArribosSegmentadores(scopedRows){
    var diaSelect = document.getElementById("arribosFiltroDia");
    var tiendaSelect = document.getElementById("arribosFiltroTienda");
    var asesorSelect = document.getElementById("arribosFiltroAsesor");
    if(!diaSelect || !tiendaSelect || !asesorSelect) return;

    var diaVal = diaSelect.value, tiendaVal = tiendaSelect.value, asesorVal = asesorSelect.value;
    var dias = {}, tiendas = {}, asesores = {};
    scopedRows.forEach(function(r){ dias[r.fecha] = true; tiendas[r.tienda] = true; asesores[r.asesor] = true; });
    var diaKeys = Object.keys(dias).sort().reverse();
    var tiendaKeys = Object.keys(tiendas).sort(function(a,b){ return a.localeCompare(b, "es"); });
    var asesorKeys = Object.keys(asesores).sort(function(a,b){ return a.localeCompare(b, "es"); });

    diaSelect.innerHTML = '<option value="">DÍA · Todos</option>' + diaKeys.map(function(d){ return '<option value="' + d + '">DÍA · ' + dayLabelAr(d) + '</option>'; }).join("");
    tiendaSelect.innerHTML = '<option value="">TIENDA · Todas</option>' + tiendaKeys.map(function(t){ return '<option value="' + escapeHtmlAr(t) + '">' + escapeHtmlAr(t) + '</option>'; }).join("");
    asesorSelect.innerHTML = '<option value="">ASESOR · Todos</option>' + asesorKeys.map(function(a){ return '<option value="' + escapeHtmlAr(a) + '">' + escapeHtmlAr(a) + '</option>'; }).join("");

    if(diaKeys.indexOf(diaVal) !== -1) diaSelect.value = diaVal;
    else if(diaKeys.indexOf(todayDateAr()) !== -1) diaSelect.value = todayDateAr();
    if(tiendaKeys.indexOf(tiendaVal) !== -1) tiendaSelect.value = tiendaVal;
    if(asesorKeys.indexOf(asesorVal) !== -1) asesorSelect.value = asesorVal;
  }

  function applyArribosSegmentadores(scopedRows){
    var diaVal = document.getElementById("arribosFiltroDia").value;
    var tiendaVal = document.getElementById("arribosFiltroTienda").value;
    var asesorVal = document.getElementById("arribosFiltroAsesor").value;
    return scopedRows.filter(function(r){
      if(diaVal && r.fecha !== diaVal) return false;
      if(tiendaVal && r.tienda !== tiendaVal) return false;
      if(asesorVal && r.asesor !== asesorVal) return false;
      return true;
    });
  }

  function renderNoConcretadaAnalysis(rowsForMonth){
    var total = rowsForMonth.length;
    var concretadas = rowsForMonth.filter(function(r){ return r.concretada; }).length;
    var noConcretadas = total - concretadas;
    var pct = total ? Math.round((concretadas / total) * 1000) / 10 : 0;

    var cardsHtml = [
      { num: total, lbl: "Total arribos" },
      { num: concretadas, lbl: "Concretadas" },
      { num: noConcretadas, lbl: "No concretadas" },
      { num: pct + "%", lbl: "% Conversión" }
    ].map(function(c){
      return '<div class="arribos-summary-card"><div class="num">' + c.num + '</div><div class="lbl">' + c.lbl + '</div></div>';
    }).join("");
    document.getElementById("arribosResumenCards").innerHTML = cardsHtml;

    // Motivos de venta no concretada
    var motivos = {};
    rowsForMonth.forEach(function(r){
      if(r.concretada) return;
      var m = r.motivo || "Sin motivo especificado";
      motivos[m] = (motivos[m] || 0) + 1;
    });
    var motivoKeys = Object.keys(motivos).sort(function(a,b){ return motivos[b] - motivos[a]; });
    var maxMotivo = motivoKeys.length ? motivos[motivoKeys[0]] : 0;
    var motivosHolder = document.getElementById("arribosMotivosHolder");
    if(!motivoKeys.length){
      motivosHolder.innerHTML = '<p class="hint">No hay ventas no concretadas con este filtro.</p>';
    }else{
      motivosHolder.innerHTML = motivoKeys.map(function(m){
        var count = motivos[m];
        var widthPct = maxMotivo ? Math.round((count / maxMotivo) * 100) : 0;
        return '<div class="arribos-bar-row">' +
          '<div class="arribos-bar-label"><span class="name">' + escapeHtmlAr(m) + '</span><span class="val">' + count + '</span></div>' +
          '<div class="arribos-bar-track"><div class="arribos-bar-fill" style="width:' + widthPct + '%;"></div></div>' +
        '</div>';
      }).join("");
    }

    // Conversión por tienda
    var porTienda = {};
    rowsForMonth.forEach(function(r){
      if(!porTienda[r.tienda]) porTienda[r.tienda] = { concretadas:0, total:0 };
      porTienda[r.tienda].total++;
      if(r.concretada) porTienda[r.tienda].concretadas++;
    });
    var tiendaKeys = Object.keys(porTienda).sort(function(a,b){
      var pa = porTienda[a].total ? porTienda[a].concretadas / porTienda[a].total : 0;
      var pb = porTienda[b].total ? porTienda[b].concretadas / porTienda[b].total : 0;
      return pa - pb;
    });
    var conversionHolder = document.getElementById("arribosConversionHolder");
    if(!tiendaKeys.length){
      conversionHolder.innerHTML = '<p class="hint">Sin datos.</p>';
    }else{
      conversionHolder.innerHTML = tiendaKeys.map(function(t){
        var d = porTienda[t];
        var tpct = d.total ? Math.round((d.concretadas / d.total) * 1000) / 10 : 0;
        var cls = tpct >= 85 ? "is-good" : (tpct >= 70 ? "is-warn" : "is-bad");
        return '<div class="arribos-bar-row">' +
          '<div class="arribos-bar-label"><span class="name">' + escapeHtmlAr(t) + '</span><span class="val">' + tpct + '% (' + d.concretadas + '/' + d.total + ')</span></div>' +
          '<div class="arribos-bar-track"><div class="arribos-bar-fill ' + cls + '" style="width:' + tpct + '%;"></div></div>' +
        '</div>';
      }).join("");
    }

    // Conversión por asesor
    var porAsesor = {};
    rowsForMonth.forEach(function(r){
      var key = r.asesor;
      if(!porAsesor[key]) porAsesor[key] = { concretadas:0, total:0, tienda:r.tienda };
      porAsesor[key].total++;
      if(r.concretada) porAsesor[key].concretadas++;
    });
    var asesorConversionKeys = Object.keys(porAsesor).sort(function(a,b){
      var pa = porAsesor[a].total ? porAsesor[a].concretadas / porAsesor[a].total : 0;
      var pb = porAsesor[b].total ? porAsesor[b].concretadas / porAsesor[b].total : 0;
      return pa - pb;
    });
    var asesorConversionHolder = document.getElementById("arribosConversionAsesorHolder");
    if(!asesorConversionKeys.length){
      asesorConversionHolder.innerHTML = '<p class="hint">Sin datos.</p>';
    }else{
      asesorConversionHolder.innerHTML = asesorConversionKeys.map(function(asesor){
        var data = porAsesor[asesor];
        var pct = data.total ? Math.round((data.concretadas / data.total) * 1000) / 10 : 0;
        var cls = pct >= 85 ? "is-good" : (pct >= 70 ? "is-warn" : "is-bad");
        return '<div class="arribos-bar-row">' +
          '<div class="arribos-bar-label"><span class="name" title="' + escapeHtmlAr(asesor) + '">' + escapeHtmlAr(asesor) + '</span><span class="val">' + pct + '% (' + data.concretadas + '/' + data.total + ')</span></div>' +
          '<div class="arribos-bar-track"><div class="arribos-bar-fill ' + cls + '" style="width:' + pct + '%;"></div></div>' +
        '</div>';
      }).join("");
    }
  }

  var _arScopedRowsForMonth = []; // filas del mes ya filtradas por rol (tienda del asesor), sin aplicar segmentadores

  function renderArribosForMonth(monthKey){
    var maxDay = maxDayForMonthAr(monthKey);
    var rowsForMonth = _arRows.filter(function(r){ return monthKeyAr(r.fecha) === monthKey; });

    var scopedRows = rowsForMonth;
    if(_arIsAsesor && _arPdv){
      scopedRows = rowsForMonth.filter(function(r){ return normAr(r.tienda) === normAr(_arPdv); });
    }
    _arScopedRowsForMonth = scopedRows;

    var byStore = buildStoreData(scopedRows, maxDay);
    renderArribosTree(byStore, maxDay, _arIsAsesor);

    populateArribosSegmentadores(scopedRows);
    renderNoConcretadaAnalysis(applyArribosSegmentadores(scopedRows));

    var hint = document.getElementById("arribosSummaryHint");
    if(hint){
      hint.textContent = "Días 1 al " + maxDay + " de " + monthLabelAr(monthKey) +
        (_arIsAsesor ? " · " + (_arPdv || "tu tienda") : " · todas las tiendas");
    }
  }

  async function checkIsAsesorAr(){
    var profile = window.currentUserProfile;
    if(!profile || !profile.email || !window.supabaseClient){ _arIsAsesor = false; return; }
    try{
      var res = await window.supabaseClient.from("profiles").select("cargo").eq("email", profile.email).maybeSingle();
      var cargo = (res.data && res.data.cargo) || "";
      _arIsAsesor = normAr(cargo) === "ASESOR" || normAr(cargo) === "";
    }catch(e){ _arIsAsesor = false; }
    _arPdv = profile.pdv || "";
  }

  window.loadArribos = async function(){
    var hint = document.getElementById("arribosHint");
    if(hint) hint.textContent = "Cargando arribos…";
    try{
      await checkIsAsesorAr();
      if(_arIsAsesor && !_arPdv){
        if(hint) hint.textContent = "Tu usuario no tiene un PDV asignado todavía. Pide que te agreguen la columna pdv en profiles (Supabase).";
        document.getElementById("arribosStoresHolder").innerHTML = "";
        return;
      }
      if(!_arRows.length || Date.now() - _arRowsLoadedAt > DATA_CACHE_MS_AR){
        _arRows = await loadRawArribos();
        _arRowsLoadedAt = Date.now();
      }
      _arMonthsList = buildAvailableMonthsAr(_arRows);
      if(!_arMonthsList.length){
        if(hint) hint.textContent = "No se encontraron fechas válidas en la hoja de arribos.";
        return;
      }
      var todayKey = monthKeyAr(new Date().toISOString().slice(0,10));
      var defaultKey = _arMonthsList.some(function(m){ return m.key === todayKey; }) ? todayKey : _arMonthsList[0].key;
      populateArribosMonthSelect(_arMonthsList, defaultKey);
      if(hint) hint.textContent = "";
      renderArribosForMonth(defaultKey);
    }catch(e){
      console.error("Error cargando arribos:", e);
      if(hint) hint.textContent = "No se pudo cargar la información de arribos. Verifica tu conexión e intenta de nuevo.";
    }
  };

  document.addEventListener("DOMContentLoaded", function(){
    var expandBtn = document.getElementById("arribosExpandBtn");
    if(expandBtn){
      expandBtn.addEventListener("click", function(){
        var holder = document.getElementById("arribosStoresHolder");
        if(!holder) return;
        var hasCollapsed = Array.prototype.some.call(holder.querySelectorAll(".arribos-tree-toggle"), function(toggle){
          return toggle.textContent.trim() === "▶";
        });
        setArribosTreeExpanded(hasCollapsed);
      });
    }
    var monthSelect = document.getElementById("arribosMonthSelect");
    if(monthSelect){
      monthSelect.addEventListener("change", function(){
        if(_arRows.length) renderArribosForMonth(monthSelect.value);
      });
    }
    var diaFiltro = document.getElementById("arribosFiltroDia");
    var tiendaFiltro = document.getElementById("arribosFiltroTienda");
    var asesorFiltro = document.getElementById("arribosFiltroAsesor");
    function reRenderNoConcretada(){
      renderNoConcretadaAnalysis(applyArribosSegmentadores(_arScopedRowsForMonth));
    }
    if(diaFiltro) diaFiltro.addEventListener("change", reRenderNoConcretada);
    if(tiendaFiltro) tiendaFiltro.addEventListener("change", reRenderNoConcretada);
    if(asesorFiltro) asesorFiltro.addEventListener("change", reRenderNoConcretada);

    var captureStoresBtn = document.getElementById("arribosCaptureStoresBtn");
    if(captureStoresBtn){
      captureStoresBtn.addEventListener("click", function(){
        copyArribosCapture("arribosStoresCard", "arribos-tienda-asesor", captureStoresBtn);
      });
    }
    var captureNoConcretadasBtn = document.getElementById("arribosCaptureNoConcretadasBtn");
    if(captureNoConcretadasBtn){
      captureNoConcretadasBtn.addEventListener("click", function(){
        copyArribosCapture("arribosNoConcretadasCard", "arribos-ventas-no-concretadas", captureNoConcretadasBtn);
      });
    }
  });

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

  async function copyArribosCapture(targetId, fileName, button) {
    var container = document.getElementById(targetId);
    if (!container) return;
    var original = button.textContent;
    button.disabled = true; button.textContent = "Generando…";
    var stage = document.createElement("div");
    var copy = container.cloneNode(true);
    try {
      copy.querySelectorAll("button").forEach(function(b){ b.remove(); });
      stage.style.cssText = "position:fixed;left:-100000px;top:0;z-index:-1;background:#fff;padding:18px;width:max-content;max-width:none;";
      stage.appendChild(copy); document.body.appendChild(stage);
      var h2c = await loadHtml2Canvas();
      var canvas = await h2c(copy, { backgroundColor: "#ffffff", scale: 2, useCORS: true, logging: false });
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
    } catch (err) {
      console.error(err);
      alert("No se pudo copiar la captura.");
    } finally {
      if (stage.parentNode) stage.remove();
      setTimeout(function () { button.disabled = false; button.textContent = original; }, 1400);
    }
  }
})();
