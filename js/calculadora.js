(function(){
  var PRODUCTS = [
    { id:"oss", name:"OSS MONO + OSS LLAA", mix:0.25, tope:true, bono:10, bonoLabel:"c/u extra",
      condicion:"S/10 por cada OSS adicional a la cuota." },
    { id:"opp", name:"OPP BASE", mix:0.05, tope:true, bono:5, bonoLabel:"c/u extra",
      condicion:"S/5 por cada OPP adicional a la cuota." },
    { id:"vrbase", name:"VR LLAA BASE", mix:0.25, tope:true, bono:10, bonoLabel:"c/u extra",
      condicion:"S/10 por cada VR BASE adicional a la cuota." },
    { id:"vrcaptura", name:"VR CAPTURA", mix:0.08, tope:true, bono:0, bonoLabel:"",
      condicion:"Cumplimiento con tope de 100%." },
    { id:"reno", name:"RENO SS ≥ 49.90", mix:0.15, tope:false, bono:0, bonoLabel:"",
      condicion:"—" },
    { id:"pack", name:"PACK SS ≥ 49.90 (OSS + OPP BASE + VR BASE)", mix:0.15, tope:false, bono:0, bonoLabel:"",
      condicion:"—" },
    { id:"prepago", name:"Prepago", mix:0.07, tope:false, bono:0, bonoLabel:"",
      condicion:"—" }
  ];

  var MIN_CUMPLIMIENTO = 0.70;
  var STORAGE_KEY = "fortalecernos_comisiones_v1";

  var tbody = document.getElementById("productsBody");
  var sueldoInput = document.getElementById("sueldoBasico");
  var comisionInput = document.getElementById("comisionVariable");
  var npsInput = document.getElementById("npsLogrado");
  var misinCuotaInput = document.getElementById("misinCuota");
  var misinVentaInput = document.getElementById("misinVenta");

  function fmt(n){
    if(isNaN(n)) n = 0;
    return "S/ " + n.toLocaleString("es-PE",{minimumFractionDigits:2, maximumFractionDigits:2});
  }
  function pct(n){
    if(isNaN(n) || !isFinite(n)) n = 0;
    return (n*100).toLocaleString("es-PE",{minimumFractionDigits:1, maximumFractionDigits:1}) + "%";
  }

  // Build table rows
  PRODUCTS.forEach(function(p){
    var tr = document.createElement("tr");
    tr.dataset.id = p.id;

    var tdName = document.createElement("td");
    tdName.innerHTML = '<span class="pname">' + p.name + '</span>' +
      (p.id === "vrcaptura" ? '<span class="pcond-tag">Tope 100%</span>' : '');
    tr.appendChild(tdName);

    var tdCuota = document.createElement("td");
    tdCuota.innerHTML = '<input type="number" min="0" step="1" value="0" class="cuota-input">';
    tr.appendChild(tdCuota);

    var tdVenta = document.createElement("td");
    tdVenta.innerHTML = '<input type="number" min="0" step="1" value="0" class="venta-input">';
    tr.appendChild(tdVenta);

    var tdCump = document.createElement("td");
    tdCump.className = "cumplimiento-cell";
    tdCump.innerHTML = '<div class="bar-track"><div class="bar-fill" style="width:0%"></div></div><span class="cump-pct">0.0%</span>';
    tr.appendChild(tdCump);

    var tdMix = document.createElement("td");
    tdMix.className = "mix-cell";
    tdMix.innerHTML = '<div class="mix-wrap"><input type="number" min="0" max="100" step="0.1" value="' +
      (p.mix*100) + '" class="mix-input"><span class="pct-sign">%</span></div>';
    tr.appendChild(tdMix);

    var tdComision = document.createElement("td");
    tdComision.className = "money-cell";
    tdComision.textContent = fmt(0);
    tr.appendChild(tdComision);

    var tdBono = document.createElement("td");
    tdBono.className = "money-cell";
    tdBono.textContent = p.bono ? fmt(0) : "—";
    tr.appendChild(tdBono);

    var tdCond = document.createElement("td");
    tdCond.innerHTML = '<span class="condicion-text">' + p.condicion + '</span>';
    tr.appendChild(tdCond);

    var tdMin = document.createElement("td");
    tdMin.className = "min-cell";
    tdMin.textContent = "70%";
    tr.appendChild(tdMin);

    tbody.appendChild(tr);
  });

  function statusClass(cump){
    if(cump >= 1) return "status-good";
    if(cump >= MIN_CUMPLIMIENTO) return "status-warn";
    return "status-bad";
  }
  function barColor(cump){
    if(cump >= 1) return "var(--good)";
    if(cump >= MIN_CUMPLIMIENTO) return "var(--warn)";
    return "var(--bad)";
  }

  function recalc(){
    var sueldo = parseFloat(sueldoInput.value) || 0;
    var comisionMonto = parseFloat(comisionInput.value) || 0;

    var totalComisionProductos = 0;
    var totalBonoExtra = 0;

    PRODUCTS.forEach(function(p){
      var tr = tbody.querySelector('tr[data-id="' + p.id + '"]');
      var cuota = parseFloat(tr.querySelector(".cuota-input").value) || 0;
      var venta = parseFloat(tr.querySelector(".venta-input").value) || 0;
      var mix = (parseFloat(tr.querySelector(".mix-input").value) || 0) / 100;

      var cumplimiento = cuota > 0 ? (venta / cuota) : 0;
      var cumplimientoEfectivo = p.tope ? Math.min(cumplimiento, 1) : cumplimiento;

      var comisionProducto = 0;
      if(cumplimiento >= MIN_CUMPLIMIENTO){
        comisionProducto = mix * comisionMonto * cumplimientoEfectivo;
      }
      totalComisionProductos += comisionProducto;

      var bonoExtra = 0;
      if(p.bono > 0 && venta > cuota){
        bonoExtra = (venta - cuota) * p.bono;
      }
      totalBonoExtra += bonoExtra;

      // update cells
      var barFill = tr.querySelector(".bar-fill");
      var cumpLabel = tr.querySelector(".cump-pct");
      var widthPct = Math.min(cumplimiento, 1.5) * (100/1.5); // visual scale, caps bar rendering at 150%
      barFill.style.width = Math.max(0, Math.min(100, widthPct)) + "%";
      barFill.style.background = barColor(cumplimiento);
      cumpLabel.textContent = pct(cumplimiento);
      cumpLabel.className = "cump-pct " + statusClass(cumplimiento);

      tr.querySelector(".money-cell").textContent = fmt(comisionProducto);
      var bonoCell = tr.querySelectorAll(".money-cell")[1];
      if(p.bono > 0){
        bonoCell.textContent = fmt(bonoExtra);
      }
    });

    // NPS bonus
    var nps = parseFloat(npsInput.value) || 0;
    var npsBono = (nps >= 70) ? 50 : 0;
    document.getElementById("npsResult").innerHTML = npsBono > 0
      ? '<span class="status-good">✓ Cumple — suma ' + fmt(50) + '</span>'
      : '<span class="status-bad">Aún no llega a 70% (falta ' + (70 - nps).toFixed(1) + ' pts)</span>';

    // MIS IN bonus
    var misinCuota = parseFloat(misinCuotaInput.value) || 0;
    var misinVenta = parseFloat(misinVentaInput.value) || 0;
    var misinBono = (misinCuota > 0 && misinVenta >= misinCuota) ? 50 : 0;
    document.getElementById("misinResult").innerHTML = misinBono > 0
      ? '<span class="status-good">✓ Cumple cuota — suma ' + fmt(50) + '</span>'
      : '<span class="status-bad">No alcanza la cuota todavía</span>';

    var ganado = sueldo + totalComisionProductos + totalBonoExtra + npsBono + misinBono;

    document.getElementById("ganadoTotal").textContent = fmt(ganado);
    document.getElementById("ganadoBreakdown").innerHTML =
      '<span>Básico ' + fmt(sueldo) + '</span>' +
      '<span>Comisión productos ' + fmt(totalComisionProductos) + '</span>' +
      '<span>Bonos por unidad ' + fmt(totalBonoExtra) + '</span>' +
      '<span>NPS + MIS IN ' + fmt(npsBono + misinBono) + '</span>';

    document.getElementById("summaryRows").innerHTML =
      '<div><span>Sueldo básico</span>' + fmt(sueldo) + '</div>' +
      '<div><span>Comisión productos</span>' + fmt(totalComisionProductos) + '</div>' +
      '<div><span>Bonos por unidad extra</span>' + fmt(totalBonoExtra) + '</div>' +
      '<div><span>NPS</span>' + fmt(npsBono) + '</div>' +
      '<div><span>MIS IN</span>' + fmt(misinBono) + '</div>' +
      '<div><span>Total ganado</span>' + fmt(ganado) + '</div>';

    saveState();
  }

  function saveState(){
    try{
      var state = {
        sueldo: sueldoInput.value,
        comision: comisionInput.value,
        nps: npsInput.value,
        misinCuota: misinCuotaInput.value,
        misinVenta: misinVentaInput.value,
        products: {}
      };
      PRODUCTS.forEach(function(p){
        var tr = tbody.querySelector('tr[data-id="' + p.id + '"]');
        state.products[p.id] = {
          cuota: tr.querySelector(".cuota-input").value,
          venta: tr.querySelector(".venta-input").value,
          mix: tr.querySelector(".mix-input").value
        };
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }catch(e){ /* localStorage no disponible, se ignora */ }
  }

  function loadState(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return;
      var state = JSON.parse(raw);
      if(state.sueldo != null) sueldoInput.value = state.sueldo;
      if(state.comision != null) comisionInput.value = state.comision;
      if(state.nps != null) npsInput.value = state.nps;
      if(state.misinCuota != null) misinCuotaInput.value = state.misinCuota;
      if(state.misinVenta != null) misinVentaInput.value = state.misinVenta;
      if(state.products){
        PRODUCTS.forEach(function(p){
          var saved = state.products[p.id];
          if(!saved) return;
          var tr = tbody.querySelector('tr[data-id="' + p.id + '"]');
          if(saved.cuota != null) tr.querySelector(".cuota-input").value = saved.cuota;
          if(saved.venta != null) tr.querySelector(".venta-input").value = saved.venta;
          if(saved.mix != null) tr.querySelector(".mix-input").value = saved.mix;
        });
      }
    }catch(e){ /* ignorar datos corruptos */ }
  }

  document.getElementById("resetBtn").addEventListener("click", function(){
    if(!confirm("¿Reiniciar todos los campos de cuota, venta, mix y bonos?")) return;
    tbody.querySelectorAll(".cuota-input, .venta-input").forEach(function(i){ i.value = 0; });
    PRODUCTS.forEach(function(p){
      var tr = tbody.querySelector('tr[data-id="' + p.id + '"]');
      tr.querySelector(".mix-input").value = (p.mix*100);
    });
    npsInput.value = 0;
    misinCuotaInput.value = 0;
    misinVentaInput.value = 0;
    recalc();
  });

  document.addEventListener("input", function(e){
    if(e.target.matches("input[type=number]")) recalc();
  });

  loadState();
  recalc();
})();
