(function(){
  // ======================================================================
  // STOCK — pega aquí la URL publicada como CSV de tu Google Sheet
  // Archivo -> Compartir -> Publicar en la Web -> elige la pestaña -> CSV
  // ======================================================================
  var STOCK_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ5jEBH9aFLKg49xu7TDUkA--s1M74rgK1sOQl_m6t_0hP75zzOSfxdLc4yoaFgeTyl33t20etYOwwq/pub?gid=791449454&single=true&output=csv";

  // Nombres de columna esperados en el CSV (no distingue mayúsculas ni tildes).
  // Si tu hoja usa otro nombre para alguna de estas, agrégalo a la lista correspondiente.
  var COLUMN_ALIASES = {
    punto:   ["TEX", "PUNTO DE VENTA"],
    marca:   ["MARCA"],
    modelo:  ["MODELO", "DESCRIPCION", "DESCRIPCIÓN"],
    sku:     ["SKU"],
    serie:   ["SERIE"],
    tipo:    ["TIPO"],
    almacen: ["ALMACEN (NUEVO/USADO)", "ALMACEN", "ALMACÉN", "NUEVO/USADO", "ESTADO"]
  };

  // Filtro interno fijo: siempre se aplica antes de mostrar cualquier dato,
  // no es editable desde la interfaz. El TIPO ya no va fijo aquí: ahora es
  // un filtro más que el usuario (supervisor o asesor) puede elegir desde
  // el selector "TIPO" en pantalla.
  var FIXED_FILTERS = {
    almacen: "NUEVO"
  };

  var stockLoaded = false;
  var stockFixedFilterWarning = false;
  var stockItems = [];   // lista plana: [{punto, marca, modelo, sku, serie}, ...]

  function normalize(s){
    return (s || "").toString().trim().toUpperCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function findColIndex(headers, aliases){
    var normHeaders = headers.map(normalize);
    for(var i=0; i<aliases.length; i++){
      var idx = normHeaders.indexOf(normalize(aliases[i]));
      if(idx !== -1) return idx;
    }
    return -1;
  }

  function parseCSV(text){
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

  function buildItems(headers, rows){
    var idx = {
      punto:   findColIndex(headers, COLUMN_ALIASES.punto),
      marca:   findColIndex(headers, COLUMN_ALIASES.marca),
      modelo:  findColIndex(headers, COLUMN_ALIASES.modelo),
      sku:     findColIndex(headers, COLUMN_ALIASES.sku),
      serie:   findColIndex(headers, COLUMN_ALIASES.serie),
      tipo:    findColIndex(headers, COLUMN_ALIASES.tipo),
      almacen: findColIndex(headers, COLUMN_ALIASES.almacen)
    };
    if(idx.punto === -1){
      return { ok:false };
    }
    var items = rows.map(function(r){
      return {
        punto:  (r[idx.punto] || "").trim(),
        marca:  idx.marca  !== -1 ? (r[idx.marca]  || "").trim() : "",
        modelo: idx.modelo !== -1 ? (r[idx.modelo] || "") : "",
        sku:    idx.sku    !== -1 ? (r[idx.sku]    || "") : "",
        serie:  idx.serie  !== -1 ? (r[idx.serie]  || "") : "",
        tipo:   idx.tipo   !== -1 ? (r[idx.tipo]   || "").trim() : "",
        _almacen: idx.almacen !== -1 ? normalize(r[idx.almacen]) : null
      };
    }).filter(function(it){ return it.punto; });

    // Filtro interno fijo: solo ALMACEN = NUEVO. No es editable desde la
    // interfaz. Si la columna no existe en la hoja, este filtro simplemente
    // no se aplica (para no ocultar todo por un nombre de columna distinto).
    items = items.filter(function(it){
      if(it._almacen !== null && it._almacen !== normalize(FIXED_FILTERS.almacen)) return false;
      return true;
    });

    return { ok:true, items:items, foundAlmacen: idx.almacen !== -1 };
  }

  function populateFilters(){
    var puntoSelect = document.getElementById("stockFilterPunto");
    var marcaSelect = document.getElementById("stockFilterMarca");
    var tipoSelect = document.getElementById("stockFilterTipo");
    var puntosSet = {}, marcasSet = {}, tiposSet = {};
    stockItems.forEach(function(it){
      if(it.punto) puntosSet[it.punto] = true;
      if(it.marca) marcasSet[it.marca] = true;
      if(it.tipo) tiposSet[it.tipo] = true;
    });
    var puntos = Object.keys(puntosSet).sort();
    var marcas = Object.keys(marcasSet).sort();
    var tipos = Object.keys(tiposSet).sort();

    puntoSelect.innerHTML = '<option value="">PUNTO DE VENTA · Todo</option>' +
      puntos.map(function(p){ return '<option value="' + p.replace(/"/g,"&quot;") + '">' + p + '</option>'; }).join("");
    marcaSelect.innerHTML = '<option value="">MARCA · Todo</option>' +
      marcas.map(function(m){ return '<option value="' + m.replace(/"/g,"&quot;") + '">' + m + '</option>'; }).join("");

    if(tipos.length){
      tipoSelect.innerHTML = tipos.map(function(t){
        return '<option value="' + t.replace(/"/g,"&quot;") + '">' + t + '</option>';
      }).join("");
      // Por defecto se selecciona "EQUIPO" (o el que más se le parezca); el
      // usuario puede cambiarlo luego a CHIP, ACCESORIO, etc.
      var defaultTipo = tipos.find(function(t){ return normalize(t) === "EQUIPO"; }) || tipos[0];
      tipoSelect.value = defaultTipo;
    }else{
      tipoSelect.innerHTML = '<option value="">TIPO · Todo</option>';
    }
  }

  function renderStockSummary(){
    var filtroPunto = document.getElementById("stockFilterPunto").value;
    var filtroMarca = document.getElementById("stockFilterMarca").value;

    var chipGroups = {};    // sku -> cantidad (CHIP)
    var equipoGroups = {};  // sku -> cantidad (EQUIPO)

    stockItems.forEach(function(it){
      if(filtroPunto && it.punto !== filtroPunto) return;
      if(filtroMarca && it.marca !== filtroMarca) return;
      var tipoNorm = normalize(it.tipo || "");
      var sku = it.sku || "SIN SKU";
      if(tipoNorm === "CHIP"){
        chipGroups[sku] = (chipGroups[sku] || 0) + 1;
      }else if(tipoNorm === "EQUIPO"){
        equipoGroups[sku] = (equipoGroups[sku] || 0) + 1;
      }
    });

    renderStockPills("stockChipBody", "stockChipTotal", chipGroups);
    renderStockPills("stockEquipoBody", "stockEquipoTotal", equipoGroups);
  }

  function renderStockPills(bodyId, totalId, groups){
    var body = document.getElementById(bodyId);
    var skus = Object.keys(groups).sort(function(a, b){ return a.localeCompare(b, "es"); });

    var total = 0;
    skus.forEach(function(sku){ total += groups[sku]; });
    var totalEl = document.getElementById(totalId);
    if(totalEl) totalEl.textContent = "- " + total;

    if(!skus.length){
      body.innerHTML = '<div class="stock-pill-empty">Sin datos con este filtro.</div>';
      return;
    }
    body.innerHTML = skus.map(function(sku){
      return '<div class="stock-pill"><span class="stock-pill-sku">' + escapeHtml(sku) + '</span>' +
        '<span class="stock-pill-qty">' + groups[sku] + '</span></div>';
    }).join("");
  }

  function escapeHtml(s){
    return (s || "").toString().replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  function renderStockTable(){
    renderStockSummary();
    var tbody = document.getElementById("stockTbody");
    var filtroPunto = document.getElementById("stockFilterPunto").value;
    var filtroMarca = document.getElementById("stockFilterMarca").value;
    var filtroTipo = document.getElementById("stockFilterTipo").value;

    var filtered = stockItems.filter(function(it){
      if(filtroPunto && it.punto !== filtroPunto) return false;
      if(filtroMarca && it.marca !== filtroMarca) return false;
      if(filtroTipo && it.tipo !== filtroTipo) return false;
      return true;
    });

    filtered.sort(function(a, b){
      return a.punto.localeCompare(b.punto, "es")
        || a.marca.localeCompare(b.marca, "es")
        || a.modelo.localeCompare(b.modelo, "es");
    });

    var html = "";
    if(filtered.length === 0){
      html = '<tr><td colspan="5" style="text-align:center; color:var(--ink-soft);">No se encontraron resultados con esos filtros.</td></tr>';
    }else{
      filtered.forEach(function(it){
        html += '<tr>' +
          '<td>' + escapeHtml(it.punto) + '</td>' +
          '<td>' + escapeHtml(it.marca) + '</td>' +
          '<td>' + escapeHtml(it.modelo) + '</td>' +
          '<td class="mono">' + escapeHtml(it.sku) + '</td>' +
          '<td class="mono">' + escapeHtml(it.serie) + '</td>' +
          '</tr>';
      });
    }
    tbody.innerHTML = html;

    var hint = document.getElementById("stockUpdatedHint");
    var now = new Date();
    hint.textContent = "Actualizado a las " + now.toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit"}) +
      (stockFixedFilterWarning ? " (⚠ no se encontró la columna ALMACÉN; el filtro fijo de Nuevo no se aplicó)" : "");
  }

  var stockDefaultPuntoApplied = false;

  async function getAsesorPdv(){
    var profile = window.currentUserProfile;
    if(!profile || !profile.email || !window.supabaseClient) return null;
    try{
      var cargoRes = await window.supabaseClient
        .from("profiles").select("cargo").eq("email", profile.email).maybeSingle();
      var cargo = (cargoRes.data && cargoRes.data.cargo) || "";
      var isAsesor = normalize(cargo) === "ASESOR" || normalize(cargo) === "";
      if(isAsesor && profile.pdv) return profile.pdv;
    }catch(e){ /* si falla, no se aplica filtro por defecto */ }
    return null;
  }

  window.loadStock = async function(){
    var hint = document.getElementById("stockUpdatedHint");
    if(STOCK_CSV_URL.indexOf("PON_AQUI") !== -1){
      hint.textContent = "Falta configurar el link del CSV publicado de Google Sheets.";
      return;
    }
    hint.textContent = "Cargando datos…";
    try{
      var sep = STOCK_CSV_URL.indexOf("?") === -1 ? "?" : "&";
      var res = await fetch(STOCK_CSV_URL + sep + "_=" + Date.now());
      if(!res.ok) throw new Error("HTTP " + res.status);
      var text = await res.text();
      var table = parseCSV(text);
      if(table.length === 0){
        hint.textContent = "La hoja no devolvió datos.";
        return;
      }
      var headers = table[0];
      var rows = table.slice(1);
      var built = buildItems(headers, rows);
      if(!built.ok){
        hint.textContent = "No se encontró la columna TEX (punto de venta) en la hoja. Revisa el nombre de columna.";
        return;
      }
      stockItems = built.items;
      stockFixedFilterWarning = !built.foundAlmacen;
      populateFilters();

      // Vista de asesor: la primera vez que se carga, se preselecciona su PDV
      // (según profiles.cargo/pdv). Solo se aplica una vez, para no pisar el
      // cambio del usuario si luego elige ver otra tienda y le da Actualizar.
      if(!stockDefaultPuntoApplied){
        stockDefaultPuntoApplied = true;
        var asesorPdv = await getAsesorPdv();
        if(asesorPdv){
          var puntoSelect = document.getElementById("stockFilterPunto");
          var match = Array.prototype.slice.call(puntoSelect.options).find(function(o){
            return normalize(o.value) === normalize(asesorPdv);
          });
          if(match) puntoSelect.value = match.value;
        }
      }

      renderStockTable();
      stockLoaded = true;
    }catch(e){
      hint.textContent = "No se pudo cargar el stock. Verifica tu conexión e intenta de nuevo.";
    }
  };

  document.addEventListener("DOMContentLoaded", function(){
    var puntoSelect = document.getElementById("stockFilterPunto");
    var marcaSelect = document.getElementById("stockFilterMarca");
    var tipoSelect = document.getElementById("stockFilterTipo");
    if(puntoSelect) puntoSelect.addEventListener("change", renderStockTable);
    if(marcaSelect) marcaSelect.addEventListener("change", renderStockTable);
    if(tipoSelect) tipoSelect.addEventListener("change", renderStockTable);
    var refreshBtn = document.getElementById("stockRefreshBtn");
    if(refreshBtn) refreshBtn.addEventListener("click", function(){ window.loadStock(); });

    var toggles = document.querySelectorAll(".stock-panel-toggle");
    toggles.forEach(function(btn){
      btn.addEventListener("click", function(){
        var target = document.getElementById(btn.getAttribute("data-target"));
        if(!target) return;
        var collapsed = target.classList.toggle("is-collapsed");
        btn.textContent = collapsed ? "Expandir" : "Contraer";
      });
    });
  });
})();
