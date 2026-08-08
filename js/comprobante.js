(function(){
  var CXP_BIZ_KEY = "fortalecernos_cxp_biz_defaults";
  var CXP_NEXT_NUM_KEY = "fortalecernos_cxp_next_doc_num";

  var itemIdSeq = 0;
  var bankIdSeq = 0;

  function cxpCurrency(n){
    n = isNaN(n) ? 0 : n;
    return "S/. " + n.toFixed(2);
  }

  function cxpEscapeHtml(value){
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function addCxpItemRow(desc, qty, price, imei1, imei2){
    desc = desc || ""; qty = (qty === undefined || qty === null) ? 1 : qty; price = price || "";
    imei1 = imei1 || ""; imei2 = imei2 || "";
    var n = ++itemIdSeq;
    var wrap = document.createElement("div");
    wrap.className = "cxp-item-card";
    wrap.innerHTML =
      '<div class="cxp-item-card-head">' +
        '<span>Equipo ' + n + '</span>' +
        '<button type="button" class="cxp-del-btn" aria-label="Eliminar equipo">×</button>' +
      '</div>' +
      '<input type="text" class="cxp-input cxp-it-desc" placeholder="Ej. iPhone 13 128GB Negro" value="' + cxpEscapeHtml(desc) + '">' +
      '<div class="cxp-imei-row">' +
        '<div><label class="cxp-mini-label">IMEI 1</label><input type="text" class="cxp-input cxp-it-imei1" placeholder="356XXXXXXXXXXXX" value="' + cxpEscapeHtml(imei1) + '"></div>' +
        '<div><label class="cxp-mini-label">IMEI 2 (si es dual SIM)</label><input type="text" class="cxp-input cxp-it-imei2" placeholder="Opcional" value="' + cxpEscapeHtml(imei2) + '"></div>' +
      '</div>' +
      '<div class="cxp-qty-price-row">' +
        '<div><label class="cxp-mini-label">Cantidad</label><input type="number" class="cxp-input cxp-it-qty" min="1" value="' + qty + '"></div>' +
        '<div><label class="cxp-mini-label">Precio (S/)</label><input type="number" class="cxp-input cxp-it-price" placeholder="0.00" step="0.01" value="' + price + '"></div>' +
      '</div>';
    wrap.querySelector(".cxp-del-btn").addEventListener("click", function(){ wrap.remove(); cxpRender(); });
    wrap.querySelectorAll("input").forEach(function(inp){ inp.addEventListener("input", cxpRender); });
    document.getElementById("cxpItemsWrap").appendChild(wrap);
  }

  function addCxpBankRow(banco, cuenta, titular){
    banco = banco || ""; cuenta = cuenta || ""; titular = titular || "";
    bankIdSeq++;
    var wrap = document.createElement("div");
    wrap.className = "cxp-bank-row";
    wrap.innerHTML =
      '<input type="text" class="cxp-input cxp-bk-banco" placeholder="Banco / Yape" value="' + cxpEscapeHtml(banco) + '">' +
      '<input type="text" class="cxp-input cxp-bk-cuenta" placeholder="N° cuenta / celular" value="' + cxpEscapeHtml(cuenta) + '">' +
      '<input type="text" class="cxp-input cxp-bk-titular" placeholder="Titular" value="' + cxpEscapeHtml(titular) + '">' +
      '<button type="button" class="cxp-del-btn" aria-label="Eliminar">×</button>';
    wrap.querySelector(".cxp-del-btn").addEventListener("click", function(){ wrap.remove(); cxpRender(); });
    wrap.querySelectorAll("input").forEach(function(inp){ inp.addEventListener("input", cxpRender); });
    document.getElementById("cxpBanksWrap").appendChild(wrap);
  }

  function cxpVal(id){ var el = document.getElementById(id); return el ? el.value : ""; }

  function cxpRender(){
    var bizName = cxpVal("cxpBizName").trim() || "TU NEGOCIO";
    var bizRuc = cxpVal("cxpBizRuc").trim();
    var bizAddr = cxpVal("cxpBizAddr").trim();
    var bizPhone = cxpVal("cxpBizPhone").trim();

    document.getElementById("cxpPvBizName").textContent = bizName;
    var subParts = [bizRuc ? "RUC " + bizRuc : null, bizAddr, bizPhone].filter(Boolean);
    document.getElementById("cxpPvBizSub").textContent = subParts.length ? subParts.join(" · ") : "RUC · DIRECCIÓN · TELÉFONO";

    document.getElementById("cxpPvDocNum").textContent = "N° " + (cxpVal("cxpDocNum").trim() || "00000001");

    var dateVal = cxpVal("cxpDocDate");
    document.getElementById("cxpPvDate").textContent = dateVal
      ? new Date(dateVal + "T00:00:00").toLocaleDateString("es-PE", { day:"2-digit", month:"2-digit", year:"numeric" })
      : "—";
    document.getElementById("cxpPvModo").textContent = cxpVal("cxpDocModo");

    document.getElementById("cxpPvCliName").textContent = cxpVal("cxpCliName").trim() || "—";
    document.getElementById("cxpPvCliDoc").textContent = cxpVal("cxpCliDoc").trim() || "—";
    var cliPhone = cxpVal("cxpCliPhone").trim();
    document.getElementById("cxpPvCliPhone").textContent = cliPhone || "—";
    var cliAddr = cxpVal("cxpCliAddr").trim();
    document.getElementById("cxpPvCliAddrRow").style.display = cliAddr ? "flex" : "none";
    document.getElementById("cxpPvCliAddr").textContent = cliAddr;

    // equipos
    var rows = Array.prototype.slice.call(document.querySelectorAll("#cxpItemsWrap .cxp-item-card"));
    var total = 0;
    var tbody = document.getElementById("cxpPvItems");
    tbody.innerHTML = "";
    rows.forEach(function(r){
      var desc = r.querySelector(".cxp-it-desc").value.trim();
      var imei1 = r.querySelector(".cxp-it-imei1").value.trim();
      var imei2 = r.querySelector(".cxp-it-imei2").value.trim();
      var qty = parseFloat(r.querySelector(".cxp-it-qty").value) || 0;
      var price = parseFloat(r.querySelector(".cxp-it-price").value) || 0;
      var sub = qty * price;
      total += sub;
      if(!desc && !price) return;
      var imeiLines = [imei1 ? "IMEI 1: " + cxpEscapeHtml(imei1) : null, imei2 ? "IMEI 2: " + cxpEscapeHtml(imei2) : null].filter(Boolean).join("<br>");
      var tr = document.createElement("tr");
      tr.innerHTML = '<td><span class="cxp-item-desc">' + cxpEscapeHtml(desc || "(sin descripción)") + '</span><br>' +
        '<span class="cxp-item-sub">' + cxpCurrency(price) + ' c/u</span>' +
        (imeiLines ? '<br><span class="cxp-item-sub">' + imeiLines + '</span>' : '') + '</td>' +
        '<td class="cxp-num">' + qty + '</td><td class="cxp-num">' + cxpCurrency(sub) + '</td>';
      tbody.appendChild(tr);
    });
    if(rows.length === 0){
      tbody.innerHTML = '<tr><td colspan="3" style="color:var(--ink-soft); padding:8px 0;">Agrega equipos en el formulario…</td></tr>';
    }

    document.getElementById("cxpPvTotal").textContent = cxpCurrency(total);
    var paid = parseFloat(cxpVal("cxpPayAmount")) || 0;
    var balance = parseFloat(cxpVal("cxpPayBalance"));
    document.getElementById("cxpPvPaid").textContent = cxpCurrency(paid);
    document.getElementById("cxpPvPayMethod").textContent = cxpVal("cxpPayMethod");
    document.getElementById("cxpPvBalance").textContent = cxpCurrency(isNaN(balance) ? Math.max(total - paid, 0) : balance);

    var op = cxpVal("cxpPayOp").trim();
    document.getElementById("cxpPvOpRow").style.display = op ? "flex" : "none";
    document.getElementById("cxpPvOp").textContent = op;

    // cuentas
    var bankRows = Array.prototype.slice.call(document.querySelectorAll("#cxpBanksWrap .cxp-bank-row"));
    var banksBlock = document.getElementById("cxpPvBanksBlock");
    var banksList = document.getElementById("cxpPvBanks");
    banksList.innerHTML = "";
    var any = false;
    bankRows.forEach(function(r){
      var banco = r.querySelector(".cxp-bk-banco").value.trim();
      var cuenta = r.querySelector(".cxp-bk-cuenta").value.trim();
      var titular = r.querySelector(".cxp-bk-titular").value.trim();
      if(!banco && !cuenta) return;
      any = true;
      var line = document.createElement("div");
      line.className = "cxp-bankline";
      line.innerHTML = "<span>" + cxpEscapeHtml(banco + (titular ? " · " + titular : "")) + "</span><span>" + cxpEscapeHtml(cuenta) + "</span>";
      banksList.appendChild(line);
    });
    banksBlock.style.display = any ? "block" : "none";

    // enlace de WhatsApp
    var waBtn = document.getElementById("cxpWaBtn");
    var cliPhoneRaw = cxpVal("cxpCliPhone").trim();
    var cliNameVal = cxpVal("cxpCliName").trim();
    var digits = cliPhoneRaw.replace(/[^0-9]/g, "");

    if(digits.length >= 8){
      var waPhone = digits;
      if(waPhone.length === 9) waPhone = "51" + waPhone; // celular Perú, se agrega el código de país
      else if(waPhone.indexOf("51") !== 0 && waPhone.length < 11) waPhone = "51" + waPhone;

      var models = rows.map(function(r){ return r.querySelector(".cxp-it-desc").value.trim(); }).filter(Boolean);
      var modelsText = models.length ? models.join(", ") : "tu equipo";
      var docNumVal = cxpVal("cxpDocNum").trim() || "00000001";
      var balanceVal = isNaN(balance) ? Math.max(total - paid, 0) : balance;

      var msg = "Hola " + (cliNameVal || "") + ", te comparto tu comprobante de venta por tu " + modelsText + ". Total: " + cxpCurrency(total) + ".";
      if(balanceVal > 0){
        msg += " Pagado: " + cxpCurrency(paid) + ". Saldo pendiente: " + cxpCurrency(balanceVal) + ".";
      }
      msg += " ¡Gracias por tu compra!";

      waBtn.href = "https://wa.me/" + waPhone + "?text=" + encodeURIComponent(msg);
      waBtn.classList.remove("is-disabled");
    }else{
      waBtn.href = "#";
      waBtn.classList.add("is-disabled");
    }
  }

  var CXP_FALLBACK_BIZ = {
    name: "FORTALECERNOS S.A.C.",
    ruc: "20611685689",
    addr: "JR. SAENZ PEÑA NRO. 451 DPTO. 302, LIMA - LIMA - MAGDALENA DEL MAR",
    phone: "",
    banks: []
  };

  function loadCxpDefaults(){
    var d = CXP_FALLBACK_BIZ;
    try{
      var raw = localStorage.getItem(CXP_BIZ_KEY);
      if(raw) d = JSON.parse(raw);
    }catch(e){ /* nada guardado aún, se usa el valor por defecto */ }

    document.getElementById("cxpBizName").value = d.name || "";
    document.getElementById("cxpBizRuc").value = d.ruc || "";
    document.getElementById("cxpBizAddr").value = d.addr || "";
    document.getElementById("cxpBizPhone").value = d.phone || "";
    if(Array.isArray(d.banks) && d.banks.length){
      d.banks.forEach(function(b){ addCxpBankRow(b.banco, b.cuenta, b.titular); });
    }

    var next = "00000001";
    try{
      next = localStorage.getItem(CXP_NEXT_NUM_KEY) || "00000001";
    }catch(e){ next = "00000001"; }
    document.getElementById("cxpDocNum").value = next;
  }

  var _cxpInited = false;
  window.initComprobante = function(){
    if(_cxpInited) return;
    _cxpInited = true;

    document.getElementById("cxpAddItem").addEventListener("click", function(){ addCxpItemRow(); cxpRender(); });
    document.getElementById("cxpAddBank").addEventListener("click", function(){ addCxpBankRow(); cxpRender(); });
    document.getElementById("cxpPrintBtn").addEventListener("click", function(){ window.print(); });

    ["cxpBizName","cxpBizRuc","cxpBizAddr","cxpBizPhone","cxpCliName","cxpCliDoc","cxpCliPhone","cxpCliAddr",
     "cxpDocNum","cxpDocDate","cxpDocModo","cxpPayMethod","cxpPayOp","cxpPayAmount","cxpPayBalance"]
      .forEach(function(id){
        var el = document.getElementById(id);
        if(el) el.addEventListener("input", cxpRender);
      });
    document.getElementById("cxpDocModo").addEventListener("change", cxpRender);
    document.getElementById("cxpPayMethod").addEventListener("change", cxpRender);

    document.getElementById("cxpSaveDefaults").addEventListener("click", function(){
      var banks = Array.prototype.slice.call(document.querySelectorAll("#cxpBanksWrap .cxp-bank-row")).map(function(r){
        return {
          banco: r.querySelector(".cxp-bk-banco").value.trim(),
          cuenta: r.querySelector(".cxp-bk-cuenta").value.trim(),
          titular: r.querySelector(".cxp-bk-titular").value.trim()
        };
      }).filter(function(b){ return b.banco || b.cuenta; });

      var data = {
        name: cxpVal("cxpBizName").trim(),
        ruc: cxpVal("cxpBizRuc").trim(),
        addr: cxpVal("cxpBizAddr").trim(),
        phone: cxpVal("cxpBizPhone").trim(),
        banks: banks
      };
      try{
        localStorage.setItem(CXP_BIZ_KEY, JSON.stringify(data));
        // se avanza el siguiente número de nota
        var cur = cxpVal("cxpDocNum").trim();
        var num = parseInt(cur, 10);
        if(!isNaN(num)){
          var next = String(num + 1).padStart(cur.length, "0");
          localStorage.setItem(CXP_NEXT_NUM_KEY, next);
        }
        var btn = document.getElementById("cxpSaveDefaults");
        var original = btn.textContent;
        btn.textContent = "Guardado ✓";
        setTimeout(function(){ btn.textContent = original; }, 1600);
      }catch(e){
        alert("No se pudo guardar. Intenta de nuevo.");
      }
    });

    addCxpItemRow();
    document.getElementById("cxpDocDate").valueAsDate = new Date();
    loadCxpDefaults();
    cxpRender();
  };

  document.addEventListener("DOMContentLoaded", function(){
    var navItems = document.querySelectorAll(".nav-item");
    navItems.forEach(function(item){
      item.addEventListener("click", function(){
        if(item.getAttribute("data-page") === "comprobante" && typeof window.initComprobante === "function"){
          window.initComprobante();
        }
      });
    });
    // por si la pestaña Comprobante ya viene activa al cargar la página
    var comprobantePage = document.getElementById("page-comprobante");
    if(comprobantePage && comprobantePage.classList.contains("active")){
      window.initComprobante();
    }
  });
})();
