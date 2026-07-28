(function(){
  var XSTORE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQmxegvOdnEIWPoL8DmR4ZeT_nl82evjTEjBNO9LTBu7pIetA60LxQr9eGcok3eDJ3CotNoRwqwxPmo/pub?gid=570485132&single=true&output=csv";

  var MONTH_NAMES_ES_X = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio",
    "Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  function normX(s){
    return (s || "").toString().trim().toUpperCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z0-9]+/g, " ").trim();
  }

  function escapeHtmlX(s){
    return (s || "").toString().replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  function findColX(headers, aliases){
    var normHeaders = headers.map(normX);
    for(var i=0; i<aliases.length; i++){
      var idx = normHeaders.indexOf(normX(aliases[i]));
      if(idx !== -1) return idx;
    }
    return -1;
  }

  function parseCSVx(text){
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

  async function fetchCsvTextX(url){
    var sep = url.indexOf("?") === -1 ? "?" : "&";
    var res = await fetch(url + sep + "_=" + Date.now());
    if(!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  }

  // Las fechas de este archivo vienen en formato peruano D/M/AAAA (ej. 23/7/2026 = 23 de julio).
  function parseDMY(v){
    if(!v) return null;
    var s = v.toString().trim();
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if(m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
    var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if(iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function monthKeyX(d){ return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
  function monthLabelX(d){ return MONTH_NAMES_ES_X[d.getMonth()] + " " + d.getFullYear(); }
  function dateLabelX(d){
    return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
  }

  function statusClassX(text){
    var t = normX(text);
    if(t.indexOf("VALIDADO") !== -1) return "status-good";
    if(t.indexOf("NO REGISTRADO") !== -1 || t.indexOf("SIN REGISTRO") !== -1) return "status-bad";
    return "";
  }

  var _xRows = null;      // todas las filas ya parseadas (de todos los meses)
  var _isAsesorX = true;
  var _profileX = null;

  async function loadXstoreRows(){
    var text = await fetchCsvTextX(XSTORE_CSV_URL);
    var table = parseCSVx(text);
    if(table.length === 0) return [];
    var headers = table[0];
    var idx = {
      fecha: findColX(headers, ["FECHA"]),
      pdv: findColX(headers, ["PDV"]),
      monto: findColX(headers, ["MONTO XSTORE"]),
      estadoRegistro: findColX(headers, ["ESTADO REGISTRO"]),
      deposito: findColX(headers, ["DEPOSITO","DEPÓSITO"]),
      payjoy: findColX(headers, ["PAYJOY"]),
      estadoDeposito: findColX(headers, ["ESTADO DEPOSITO","ESTADO DEPÓSITO"])
    };
    var rows = [];
    for(var i=1; i<table.length; i++){
      var r = table[i];
      var fechaRaw = idx.fecha !== -1 ? r[idx.fecha] : "";
      var d = parseDMY(fechaRaw);
      if(!d) continue;
      var pdv = (idx.pdv !== -1 ? r[idx.pdv] : "").trim();
      if(!pdv) continue;
      rows.push({
        dateObj: d,
        dateKey: monthKeyX(d),
        dateLabel: dateLabelX(d),
        pdv: pdv,
        pdvNorm: normX(pdv),
        monto: idx.monto !== -1 ? (r[idx.monto] || "").trim() : "",
        estadoRegistro: idx.estadoRegistro !== -1 ? (r[idx.estadoRegistro] || "").trim() : "",
        deposito: idx.deposito !== -1 ? (r[idx.deposito] || "").trim() : "",
        payjoy: idx.payjoy !== -1 ? Number(r[idx.payjoy]) === 1 : false,
        estadoDeposito: idx.estadoDeposito !== -1 ? (r[idx.estadoDeposito] || "").trim() : ""
      });
    }
    return rows;
  }

  function buildAvailableMonthsX(rows){
    var months = {};
    rows.forEach(function(r){ months[r.dateKey] = new Date(r.dateObj.getFullYear(), r.dateObj.getMonth(), 1); });
    var keys = Object.keys(months).sort().reverse();
    return keys.map(function(k){ return { key:k, date:months[k] }; });
  }

  function populateMonthSelectX(monthsList, selectedKey){
    var sel = document.getElementById("xstoreMonthSelect");
    sel.innerHTML = monthsList.map(function(m){
      return '<option value="' + m.key + '"' + (m.key === selectedKey ? " selected" : "") + '>' +
        escapeHtmlX(monthLabelX(m.date)) + '</option>';
    }).join("");
  }

  function populateDaySelectX(rows, selectedLabel){
    var sel = document.getElementById("xstoreDaySelect");
    if(!sel) return;
    var seen = {};
    var days = [];
    rows.forEach(function(r){
      if(!seen[r.dateLabel]){ seen[r.dateLabel] = true; days.push({ label:r.dateLabel, time:r.dateObj.getTime() }); }
    });
    days.sort(function(a, b){ return b.time - a.time; });
    var options = '<option value="">Día · Todos</option>' + days.map(function(d){
      return '<option value="' + d.label + '"' + (d.label === selectedLabel ? " selected" : "") + '>' + d.label + '</option>';
    }).join("");
    sel.innerHTML = options;
  }

  function renderXstoreForMonth(monthKeySel){
    var hint = document.getElementById("xstoreHint");
    var tbody = document.getElementById("xstoreTbody");
    var pdvCols = document.querySelectorAll(".xstore-pdv-col");
    var daySelect = document.getElementById("xstoreDaySelect");

    var showPdvCol = !_isAsesorX;
    pdvCols.forEach(function(el){ el.classList.toggle("is-hidden", !showPdvCol); });

    var monthFiltered = _xRows.filter(function(r){
      if(r.dateKey !== monthKeySel) return false;
      if(_isAsesorX && r.pdvNorm !== normX(_profileX.pdv)) return false;
      return true;
    });

    // El filtro de día solo tiene sentido para la vista de supervisor (varias
    // tiendas a la vez); en la vista de asesor se oculta.
    var selectedDay = "";
    if(daySelect){
      if(_isAsesorX){
        daySelect.style.display = "none";
      }else{
        daySelect.style.display = "";
        populateDaySelectX(monthFiltered, daySelect.value);
        selectedDay = daySelect.value;
      }
    }

    var filtered = selectedDay
      ? monthFiltered.filter(function(r){ return r.dateLabel === selectedDay; })
      : monthFiltered;

    filtered.sort(function(a, b){
      if(a.dateObj.getTime() !== b.dateObj.getTime()) return b.dateObj.getTime() - a.dateObj.getTime();
      return a.pdv.localeCompare(b.pdv, "es");
    });

    if(filtered.length === 0){
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--ink-soft);">' +
        'No hay datos para el mes seleccionado.</td></tr>';
      hint.textContent = "0 registros";
      return;
    }

    var html = "";
    var lastDateKey = null;
    filtered.forEach(function(r){
      var dayKey = r.dateObj.getTime();
      var isNewDate = dayKey !== lastDateKey;
      lastDateKey = dayKey;

      var estadoRegistroClass = statusClassX(r.estadoRegistro);
      var estadoDepositoClass = statusClassX(r.estadoDeposito);
      var payjoyTag = r.payjoy ? ' <span class="payjoy-tag">Payjoy</span>' : "";

      html += '<tr' + (isNewDate ? ' data-newdate="1"' : '') + '>' +
        '<td>' + escapeHtmlX(r.dateLabel) + '</td>' +
        '<td class="xstore-pdv-col' + (showPdvCol ? "" : " is-hidden") + '">' + escapeHtmlX(r.pdv) + '</td>' +
        '<td class="xstore-money">' + escapeHtmlX(r.monto) + '</td>' +
        '<td class="' + estadoRegistroClass + '">' + escapeHtmlX(r.estadoRegistro) + '</td>' +
        '<td class="xstore-money">' + escapeHtmlX(r.deposito) + '</td>' +
        '<td class="' + estadoDepositoClass + '">' + escapeHtmlX(r.estadoDeposito) + payjoyTag + '</td>' +
        '</tr>';
    });
    tbody.innerHTML = html;
    hint.textContent = filtered.length + " registro(s) · " + monthLabelX(filtered[0] ? new Date(monthKeySel + "-01") : new Date());
  }

  window.loadXstore = async function(){
    var hint = document.getElementById("xstoreHint");
    var tbody = document.getElementById("xstoreTbody");
    var profile = window.currentUserProfile;

    if(!profile){
      hint.textContent = "No se pudo identificar tu usuario.";
      return;
    }
    _profileX = profile;

    var cargo = "";
    try{
      var cargoRes = await window.supabaseClient
        .from("profiles").select("cargo").eq("email", profile.email).maybeSingle();
      cargo = (cargoRes.data && cargoRes.data.cargo) || "";
    }catch(e){ cargo = ""; }
    _isAsesorX = normX(cargo) === "ASESOR" || normX(cargo) === "";

    var crearBtn = document.getElementById("xstoreCrearBtn");
    var titleEl = document.getElementById("xstoreTitle");
    if(crearBtn) crearBtn.style.display = _isAsesorX ? "" : "none";
    if(titleEl){
      titleEl.textContent = "Registro y depósito diario" +
        (_isAsesorX && profile.pdv ? " - " + profile.pdv : "");
    }

    if(_isAsesorX && !profile.pdv){
      hint.textContent = "Tu usuario no tiene un PDV asignado todavía. Pide que te agreguen la columna pdv en profiles (Supabase).";
      tbody.innerHTML = "";
      return;
    }

    hint.textContent = "Cargando datos…";
    try{
      _xRows = await loadXstoreRows();
      if(_xRows.length === 0){
        hint.textContent = "No se encontraron datos en el archivo.";
        tbody.innerHTML = "";
        return;
      }
      var monthsList = buildAvailableMonthsX(_xRows);
      var todayKey = monthKeyX(new Date());
      var defaultKey = monthsList.some(function(m){ return m.key === todayKey; }) ? todayKey : monthsList[0].key;
      populateMonthSelectX(monthsList, defaultKey);
      renderXstoreForMonth(defaultKey);
    }catch(e){
      hint.textContent = "No se pudo cargar el control Xstore. Verifica tu conexión e intenta de nuevo.";
      console.error(e);
    }
  };

  document.addEventListener("DOMContentLoaded", function(){
    var monthSelect = document.getElementById("xstoreMonthSelect");
    if(monthSelect){
      monthSelect.addEventListener("change", function(){
        var daySelect = document.getElementById("xstoreDaySelect");
        if(daySelect) daySelect.value = ""; // al cambiar de mes, se reinicia el filtro de día
        if(_xRows) renderXstoreForMonth(monthSelect.value);
      });
    }
    var daySelect = document.getElementById("xstoreDaySelect");
    if(daySelect){
      daySelect.addEventListener("change", function(){
        var monthSel = document.getElementById("xstoreMonthSelect");
        if(_xRows && monthSel) renderXstoreForMonth(monthSel.value);
      });
    }
    var refreshBtn = document.getElementById("xstoreRefreshBtn");
    if(refreshBtn){
      refreshBtn.addEventListener("click", function(){
        if(typeof window.loadXstore === "function") window.loadXstore();
      });
    }
    var crearBtn = document.getElementById("xstoreCrearBtn");
    if(crearBtn){
      crearBtn.addEventListener("click", function(){
        document.querySelectorAll(".page").forEach(function(p){ p.classList.remove("active"); });
        var target = document.getElementById("page-xstore-crear");
        if(target) target.classList.add("active");
      });
    }
    var crearBackBtn = document.getElementById("xstoreCrearBackBtn");
    if(crearBackBtn){
      crearBackBtn.addEventListener("click", function(){
        document.querySelectorAll(".page").forEach(function(p){ p.classList.remove("active"); });
        var target = document.getElementById("page-xstore");
        if(target) target.classList.add("active");
      });
    }
  });
})();
