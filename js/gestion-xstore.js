(function(){
  var MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  var state = { profile:null, role:"", rows:[], deposits:[], pdvs:[], selectedPdvs:[], month:"", loading:false, reviewingId:null };

  function esc(value){ return String(value == null ? "" : value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function norm(value){ return String(value || "").trim().toLowerCase(); }
  function money(value){ return new Intl.NumberFormat("es-PE",{style:"currency",currency:"PEN",minimumFractionDigits:2}).format(Number(value || 0)); }
  function today(){ return new Date().toISOString().slice(0,10); }
  function monthKey(date){ return date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0"); }
  function monthLabel(key){ var bits=key.split("-"); return MONTHS[Number(bits[1])-1]+" "+bits[0]; }
  function monthBounds(key){ var parts=key.split("-"); var year=Number(parts[0]), month=Number(parts[1]); return { from:key+"-01", to:year+"-"+String(month).padStart(2,"0")+"-"+String(new Date(year,month,0).getDate()).padStart(2,"0") }; }
  function dateEs(value){ if(!value) return "—"; var parts=String(value).slice(0,10).split("-"); return parts.length===3 ? parts[2]+"/"+parts[1]+"/"+parts[0] : value; }
  function isAdvisor(){ return norm(state.role) === "asesor"; }
  function isOperations(){ return norm(state.role) === "operaciones"; }
  function setHint(text, isError){ var el=document.getElementById("gxHint"); if(el){ el.textContent=text; el.style.color=isError ? "#b91c1c" : ""; } }
  function setFormHint(id,text,isError){ var el=document.getElementById(id); if(el){ el.textContent=text||""; el.style.color=isError ? "#b91c1c" : ""; } }
  function statusLabel(status){ return ({missing_cash:"Sin registro de caja",pending_deposit:"Pendiente de depósito",deposit_review:"Depósito en revisión",validated:"Cuadrado",payjoy_validated:"Cuadrado · PayJoy",difference:"Diferencia por revisar",observed:"Observado",store_closed:"Tienda no abrió",no_cash:"Recaudo cero declarado"})[status] || status; }
  function isFinal(status){ return ["validated","payjoy_validated","difference","store_closed","no_cash"].indexOf(status) !== -1; }
  function isEligibleForDeposit(row){ return row.closure_id && row.cash_amount > 0 && !row.review_started_at && ["pending_deposit","deposit_review","observed"].indexOf(row.status) !== -1; }
  function selectedRows(){ return state.selectedPdvs.length ? state.rows.filter(function(r){ return state.selectedPdvs.indexOf(r.pdv)!==-1; }) : state.rows.slice(); }

  function populateMonths(){
    var select=document.getElementById("gxMonthSelect"); if(!select) return;
    var current=new Date(), keys=[];
    for(var i=0;i<12;i++){ var d=new Date(current.getFullYear(),current.getMonth()-i,1); keys.push(monthKey(d)); }
    if(!state.month) state.month=keys[0];
    select.innerHTML=keys.map(function(key){ return '<option value="'+key+'"'+(key===state.month?' selected':'')+'>'+monthLabel(key)+'</option>'; }).join("");
  }

  function renderPdvMenu(){
    var filter=document.getElementById("gxPdvFilter"), menu=document.getElementById("gxPdvMenu"), button=document.getElementById("gxPdvButton");
    if(!filter||!menu||!button) return;
    if(isAdvisor()){ filter.hidden=true; return; }
    filter.hidden=false;
    state.selectedPdvs=state.selectedPdvs.filter(function(p){ return state.pdvs.indexOf(p)!==-1; });
    var all=!state.selectedPdvs.length;
    button.textContent=all ? "PDV · Todos" : "PDV · "+(state.selectedPdvs.length===1?state.selectedPdvs[0]:state.selectedPdvs.length+" seleccionados");
    menu.innerHTML='<label class="gx-pdv-all"><input type="checkbox" data-gx-pdv-all'+(all?' checked':'')+'> Todos los PDV</label>'+state.pdvs.map(function(p){ return '<label><input type="checkbox" data-gx-pdv="'+esc(p)+'"'+(state.selectedPdvs.indexOf(p)!==-1?' checked':'')+'> '+esc(p)+'</label>'; }).join("");
  }

  function depositEvidenceFor(row){
    var paths=[];
    state.deposits.forEach(function(deposit){ (deposit.allocations||[]).forEach(function(allocation){ if(allocation.closure_id===row.closure_id && deposit.evidence_path) paths.push(deposit.evidence_path); }); });
    return paths;
  }

  function renderSummary(rows){
    var missing=rows.filter(function(r){ return r.status==="missing_cash"; }).length;
    var pending=rows.reduce(function(total,r){ return total+(r.status!=="missing_cash"&&!r.no_cash&&!r.store_closed?Number(r.outstanding_amount||0):0); },0);
    var review=rows.filter(function(r){ return r.status==="deposit_review"; }).length;
    var difference=rows.filter(function(r){ return r.status==="difference"; }).length;
    var holder=document.getElementById("gxSummary"); if(!holder) return;
    holder.innerHTML='<article class="gx-summary-card is-danger"><span>Sin registro de caja</span><strong>'+missing+'</strong></article>'+
      '<article class="gx-summary-card is-alert"><span>Pendiente de depósito</span><strong>'+esc(money(pending))+'</strong></article>'+
      '<article class="gx-summary-card"><span>Depósitos en revisión</span><strong>'+review+'</strong></article>'+
      '<article class="gx-summary-card '+(difference?'is-danger':'is-good')+'"><span>Diferencias por revisar</span><strong>'+difference+'</strong></article>';
  }

  function reviewEditor(row){
    return '<tr class="gx-inline-review"><td colspan="8"><form class="gx-inline-review-card" data-gx-review-form>'+ 
      '<input type="hidden" data-gx-review-id value="'+esc(row.closure_id)+'">'+
      '<div class="gx-inline-review-header"><div><h3>Resolver · '+esc(row.pdv)+' · '+dateEs(row.cash_date)+'</h3><p>Monto reportado: '+money(row.cash_amount)+' · Depósitos: '+money(row.deposit_amount)+' · Pendiente: '+money(row.outstanding_amount)+'</p></div><button type="button" class="gx-close-panel" data-gx-close-inline aria-label="Cerrar">×</button></div>'+ 
      '<div class="gx-inline-review-fields">'+
      '<label>Monto de caja correcto<input data-gx-correct-cash type="number" min="0" step="0.01" inputmode="decimal" value="'+Number(row.cash_amount||0).toFixed(2)+'"></label>'+ 
      '<label>Resolución<select data-gx-resolution><option value="validated">Cuadrado</option><option value="payjoy_validated">Cuadrado · PayJoy</option><option value="difference">Diferencia por revisar</option><option value="observed">Observar y devolver</option></select></label>'+ 
      '<label data-gx-payjoy-wrap hidden>Monto PayJoy<input data-gx-payjoy type="number" min="0" step="0.01" inputmode="decimal" value="0"></label>'+ 
      '<label>Observación<input data-gx-review-note type="text" maxlength="240" placeholder="Comentario para el equipo"></label>'+ 
      '</div><div class="gx-form-actions"><span data-gx-review-hint></span><button class="gx-action-btn" type="submit">Guardar validación</button></div>'+ 
      '</form></td></tr>';
  }

  function renderTable(){
    var body=document.getElementById("gxTbody"); if(!body) return;
    var rows=selectedRows(); renderSummary(rows);
    if(!rows.length){ body.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--ink-soft)">No hay cierres esperados para el período seleccionado.</td></tr>'; return; }
    body.innerHTML=rows.map(function(row){
      var actions=[];
      if(row.evidence_path) actions.push('<button class="gx-row-btn" data-gx-evidence="'+esc(row.evidence_path)+'">Caja</button>');
      var voucherPaths=depositEvidenceFor(row); if(voucherPaths.length) actions.push('<button class="gx-row-btn" data-gx-evidence="'+esc(voucherPaths[0])+'">Voucher'+(voucherPaths.length>1?' ('+voucherPaths.length+')':'')+'</button>');
      if(isOperations() && row.closure_id && !isFinal(row.status)){
        if(!row.review_started_at) actions.push('<button class="gx-row-btn" data-gx-start-review="'+row.closure_id+'">Iniciar revisión</button>');
        else actions.push('<button class="gx-row-btn" data-gx-resolve="'+row.closure_id+'">Resolver</button>');
      }
      var trace=row.registered_by_email ? 'Caja: '+row.registered_by_email+(row.updated_by_email&&row.updated_by_email!==row.registered_by_email?' · Act.: '+row.updated_by_email:'') : 'Sin declaración';
      var tableRow='<tr><td>'+dateEs(row.cash_date)+'</td><td>'+esc(row.pdv)+'</td><td class="gx-money '+(!row.closure_id?'gx-amount-muted':'')+'">'+(row.closure_id?money(row.cash_amount):'—')+'</td><td class="gx-money">'+(row.closure_id?money(row.deposit_amount):'—')+'</td><td class="gx-money">'+(row.closure_id?money(row.outstanding_amount):'—')+'</td><td><span class="gx-status '+esc(row.status)+'">'+esc(statusLabel(row.status))+'</span></td><td title="'+esc(trace)+'">'+esc(trace)+'</td><td><div class="gx-row-actions">'+actions.join("")+'</div></td></tr>';
      return tableRow+(state.reviewingId===row.closure_id?reviewEditor(row):"");
    }).join("");
  }

  async function loadData(){
    if(state.loading||!state.profile||!window.supabaseClient) return;
    state.loading=true; setHint("Cargando registros…");
    try{
      var range=monthBounds(state.month), results=await Promise.all([
        window.supabaseClient.rpc("xstore_dashboard_rows",{p_from:range.from,p_to:range.to}),
        window.supabaseClient.rpc("xstore_monthly_deposits",{p_from:range.from,p_to:range.to})
      ]);
      if(results[0].error) throw results[0].error;
      if(results[1].error) throw results[1].error;
      state.rows=results[0].data||[]; state.deposits=results[1].data||[];
      state.pdvs=Array.from(new Set(state.rows.map(function(r){ return r.pdv; }))).sort(function(a,b){ return a.localeCompare(b,"es"); });
      renderPdvMenu(); renderTable(); populateAllocationList();
      setHint(state.rows.length+" cierre(s) esperado(s) · "+monthLabel(state.month));
    }catch(error){ console.error("Gestión Xstore:",error); state.rows=[]; state.deposits=[]; renderTable(); setHint("No se pudo cargar Gestión Xstore. Ejecuta primero supabase/004_gestion_xstore.sql.",true); }
    finally{ state.loading=false; }
  }

  function showPanel(name){
    ["gxCashPanel","gxDepositPanel"].forEach(function(id){ var panel=document.getElementById(id); if(panel) panel.hidden=id!=="gx"+name.charAt(0).toUpperCase()+name.slice(1)+"Panel"; });
    if(name==="cash"){ document.getElementById("gxCashDate").value=today(); syncStoreClosedFields(); setFormHint("gxCashFormHint",""); }
    if(name==="deposit"){ document.getElementById("gxDepositDate").value=today(); setFormHint("gxDepositFormHint",""); populateAllocationList(); }
  }
  function hidePanel(name){
    if(name==="review"){ state.reviewingId=null; renderTable(); return; }
    var panel=document.getElementById("gx"+name.charAt(0).toUpperCase()+name.slice(1)+"Panel"); if(panel) panel.hidden=true;
  }

  function populateAllocationList(){
    var holder=document.getElementById("gxAllocationList"); if(!holder||!isAdvisor()) return;
    var candidates=state.rows.filter(function(row){ return row.pdv===state.profile.pdv && isEligibleForDeposit(row); });
    holder.innerHTML=candidates.length?candidates.map(function(row){ return '<label class="gx-allocation-row"><input type="checkbox" data-gx-allocation="'+row.closure_id+'" data-gx-max="'+Number(row.outstanding_amount||0)+'"><span>'+dateEs(row.cash_date)+' · Pendiente '+money(row.outstanding_amount)+'</span><input type="number" min="0.01" step="0.01" data-gx-allocation-amount="'+row.closure_id+'" disabled></label>'; }).join(""):'<span class="hint">No hay días disponibles para asociar a un depósito.</span>';
  }
  function refreshDepositTotal(){
    var sum=0; document.querySelectorAll("[data-gx-allocation-amount]").forEach(function(input){ if(!input.disabled) sum+=Number(input.value||0); });
    var total=document.getElementById("gxDepositAmount"); if(total) total.value=sum?sum.toFixed(2):"";
  }

  async function compressImage(file){
    if(!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Adjunta una imagen JPG, PNG o WebP.");
    var source=await new Promise(function(resolve,reject){ var reader=new FileReader(); reader.onload=function(){ var image=new Image(); image.onload=function(){resolve(image);}; image.onerror=reject; image.src=reader.result; }; reader.onerror=reject; reader.readAsDataURL(file); });
    var scale=Math.min(1,1600/Math.max(source.width,source.height)), canvas=document.createElement("canvas"); canvas.width=Math.max(1,Math.round(source.width*scale)); canvas.height=Math.max(1,Math.round(source.height*scale));
    canvas.getContext("2d").drawImage(source,0,0,canvas.width,canvas.height);
    var blob=await new Promise(function(resolve){ canvas.toBlob(resolve,"image/webp",.74); }); if(!blob) throw new Error("No se pudo preparar la imagen.");
    if(blob.size>1500000) throw new Error("La imagen sigue siendo muy pesada. Toma una foto más cercana o con menor resolución.");
    return blob;
  }
  function pdvFolder(pdv){ return String(pdv||"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,""); }
  async function uploadEvidence(file,kind){
    var blob=await compressImage(file), path="pdv/"+pdvFolder(state.profile.pdv)+"/"+kind+"-"+Date.now()+"-"+crypto.randomUUID()+".webp";
    var result=await window.supabaseClient.storage.from("xstore-evidencias").upload(path,blob,{contentType:"image/webp",upsert:false});
    if(result.error) throw result.error; return path;
  }
  function syncStoreClosedFields(){
    var closed=document.getElementById("gxStoreClosed").checked, amount=document.getElementById("gxCashAmount"), file=document.getElementById("gxCashFile");
    amount.disabled=closed;
    if(closed) amount.value="0";
    file.required=!closed;
    document.getElementById("gxStoreClosedReasonWrap").hidden=!closed;
  }

  async function submitCash(event){
    event.preventDefault(); setFormHint("gxCashFormHint","");
    var storeClosed=document.getElementById("gxStoreClosed").checked, amount=Number(document.getElementById("gxCashAmount").value||0), file=document.getElementById("gxCashFile").files[0];
    try{
      setFormHint("gxCashFormHint","Guardando evidencia…");
      var path=storeClosed?"":await uploadEvidence(file,"caja");
      var result=await window.supabaseClient.rpc("xstore_submit_cash",{p_cash_date:document.getElementById("gxCashDate").value,p_cash_amount:storeClosed?0:amount,p_evidence_path:path,p_store_closed:storeClosed,p_store_closed_reason:document.getElementById("gxStoreClosedReason").value});
      if(result.error) throw result.error;
      event.target.reset(); hidePanel("cash"); await loadData();
    }catch(error){ setFormHint("gxCashFormHint",error.message||"No se pudo guardar el recaudo.",true); }
  }
  async function submitDeposit(event){
    event.preventDefault(); setFormHint("gxDepositFormHint","");
    var allocations=[]; document.querySelectorAll("[data-gx-allocation]:checked").forEach(function(check){ var id=check.getAttribute("data-gx-allocation"), input=document.querySelector('[data-gx-allocation-amount="'+CSS.escape(id)+'"]'); allocations.push({closure_id:id,amount:Number(input.value||0)}); });
    try{
      if(!allocations.length) throw new Error("Selecciona al menos un día de caja.");
      setFormHint("gxDepositFormHint","Subiendo voucher…");
      var path=await uploadEvidence(document.getElementById("gxDepositFile").files[0],"deposito"), amount=Number(document.getElementById("gxDepositAmount").value||0);
      var result=await window.supabaseClient.rpc("xstore_submit_deposit",{p_deposit_date:document.getElementById("gxDepositDate").value,p_deposit_amount:amount,p_evidence_path:path,p_allocations:allocations});
      if(result.error) throw result.error;
      event.target.reset(); hidePanel("deposit"); await loadData();
    }catch(error){ setFormHint("gxDepositFormHint",error.message||"No se pudo guardar el depósito.",true); }
  }

  function openReview(id){
    var row=state.rows.find(function(item){ return item.closure_id===id; }); if(!row) return;
    state.reviewingId=id; renderTable();
    var editor=document.querySelector("[data-gx-review-form]"); if(editor) editor.scrollIntoView({behavior:"smooth",block:"center"});
  }
  function togglePayjoy(form){ var show=form.querySelector("[data-gx-resolution]").value==="payjoy_validated"; form.querySelector("[data-gx-payjoy-wrap]").hidden=!show; }
  async function submitReview(event){
    event.preventDefault(); var form=event.target, hint=form.querySelector("[data-gx-review-hint]"), closureId=form.querySelector("[data-gx-review-id]").value;
    if(hint){ hint.textContent=""; hint.style.color=""; }
    try{
      var row=state.rows.find(function(item){ return item.closure_id===closureId; }), correctedAmount=Number(form.querySelector("[data-gx-correct-cash]").value||0), note=form.querySelector("[data-gx-review-note]").value;
      if(!row || correctedAmount<0) throw new Error("El monto de caja no es válido.");
      if(Math.abs(correctedAmount-Number(row.cash_amount||0))>0.004){
        var correction=await window.supabaseClient.rpc("xstore_correct_cash_amount",{p_closure_id:closureId,p_cash_amount:correctedAmount,p_note:note});
        if(correction.error) throw correction.error;
      }
      var result=await window.supabaseClient.rpc("xstore_resolve_closure",{p_closure_id:closureId,p_resolution:form.querySelector("[data-gx-resolution]").value,p_payjoy_amount:Number(form.querySelector("[data-gx-payjoy]").value||0),p_note:note});
      if(result.error) throw result.error; hidePanel("review"); await loadData();
    }catch(error){ if(hint){ hint.textContent=error.message||"No se pudo guardar la validación."; hint.style.color="#b91c1c"; } }
  }
  async function startReview(id){
    try{ var result=await window.supabaseClient.rpc("xstore_start_review",{p_closure_id:id}); if(result.error) throw result.error; await loadData(); openReview(id); }
    catch(error){ alert(error.message||"No se pudo iniciar la revisión."); }
  }
  async function openEvidence(path){
    try{ var result=await window.supabaseClient.storage.from("xstore-evidencias").createSignedUrl(path,120); if(result.error) throw result.error; window.open(result.data.signedUrl,"_blank","noopener"); }
    catch(error){ alert("No se pudo abrir la evidencia."); }
  }

  function exportExcel(){
    if(!isOperations()) return;
    var rows=state.rows, deposits=state.deposits;
    var closureTable='<h2>Recaudos · '+monthLabel(state.month)+'</h2><table><thead><tr><th>Fecha caja</th><th>PDV</th><th>Recaudo</th><th>PayJoy</th><th>Depositado</th><th>Pendiente</th><th>Estado</th><th>Registrado por</th><th>Validado por</th></tr></thead><tbody>'+rows.map(function(r){ return '<tr><td>'+dateEs(r.cash_date)+'</td><td>'+esc(r.pdv)+'</td><td>'+Number(r.cash_amount||0)+'</td><td>'+Number(r.payjoy_amount||0)+'</td><td>'+Number(r.deposit_amount||0)+'</td><td>'+Number(r.outstanding_amount||0)+'</td><td>'+esc(statusLabel(r.status))+'</td><td>'+esc(r.registered_by_email||"")+'</td><td>'+esc(r.validated_by_email||"")+'</td></tr>'; }).join("")+'</tbody></table>';
    var depositTable='<h2>Depósitos · '+monthLabel(state.month)+'</h2><table><thead><tr><th>Fecha depósito</th><th>PDV</th><th>Monto</th><th>Registrado por</th><th>Fechas de caja cubiertas</th></tr></thead><tbody>'+deposits.map(function(d){ var allocations=(d.allocations||[]).map(function(a){return dateEs(a.fecha_caja)+' · '+money(a.monto);}).join(" | "); return '<tr><td>'+dateEs(d.deposit_date)+'</td><td>'+esc(d.pdv)+'</td><td>'+Number(d.deposit_amount||0)+'</td><td>'+esc(d.registered_by_email||"")+'</td><td>'+esc(allocations)+'</td></tr>'; }).join("")+'</tbody></table>';
    var html='<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif}table{border-collapse:collapse;font-size:11pt;margin-bottom:24px}th,td{border:1px solid #cbd5e1;padding:7px}th{background:#0e1aa1;color:#fff;text-align:left}</style></head><body>'+closureTable+depositTable+'</body></html>', blob=new Blob(["\ufeff",html],{type:"application/vnd.ms-excel;charset=utf-8"}), link=document.createElement("a");
    link.href=URL.createObjectURL(blob); link.download="gestion-xstore-"+state.month+".xls"; document.body.appendChild(link); link.click(); link.remove(); setTimeout(function(){URL.revokeObjectURL(link.href);},0);
  }

  window.loadGestionXstore=async function(){
    state.profile=window.currentUserProfile; if(!state.profile||!state.profile.email){ setHint("No se pudo identificar tu usuario.",true); return; }
    state.role=state.profile.cargo||""; populateMonths();
    var actions=document.getElementById("gxEntryActions"), exportBtn=document.getElementById("gxExportBtn"); if(actions) actions.hidden=!isAdvisor(); if(exportBtn) exportBtn.hidden=!isOperations();
    await loadData();
  };

  document.addEventListener("DOMContentLoaded",function(){
    var month=document.getElementById("gxMonthSelect"); if(month) month.addEventListener("change",function(){ state.month=month.value; state.selectedPdvs=[]; loadData(); });
    document.getElementById("gxRefreshBtn").addEventListener("click",loadData); document.getElementById("gxExportBtn").addEventListener("click",exportExcel);
    document.querySelectorAll("[data-gx-open]").forEach(function(btn){ btn.addEventListener("click",function(){showPanel(btn.getAttribute("data-gx-open"));}); });
    document.querySelectorAll("[data-gx-close]").forEach(function(btn){ btn.addEventListener("click",function(){hidePanel(btn.getAttribute("data-gx-close"));}); });
    document.getElementById("gxStoreClosed").addEventListener("change",syncStoreClosedFields);
    document.getElementById("gxCashForm").addEventListener("submit",submitCash); document.getElementById("gxDepositForm").addEventListener("submit",submitDeposit);
    document.addEventListener("submit",function(event){ if(event.target.matches("[data-gx-review-form]")) submitReview(event); });
    document.addEventListener("change",function(event){ var form=event.target.closest("[data-gx-review-form]"); if(form&&event.target.matches("[data-gx-resolution]")) togglePayjoy(form); });
    document.getElementById("gxAllocationList").addEventListener("change",function(event){ var check=event.target.closest("[data-gx-allocation]"); if(check){ var input=document.querySelector('[data-gx-allocation-amount="'+CSS.escape(check.getAttribute("data-gx-allocation"))+'"]'); input.disabled=!check.checked; input.value=check.checked?Number(check.getAttribute("data-gx-max")).toFixed(2):""; refreshDepositTotal(); } });
    document.getElementById("gxAllocationList").addEventListener("input",refreshDepositTotal);
    var pdvButton=document.getElementById("gxPdvButton"), pdvMenu=document.getElementById("gxPdvMenu"); pdvButton.addEventListener("click",function(){ var open=pdvMenu.hidden; pdvMenu.hidden=!open; pdvButton.setAttribute("aria-expanded",String(open)); });
    pdvMenu.addEventListener("change",function(event){ var all=pdvMenu.querySelector("[data-gx-pdv-all]"), checks=Array.prototype.slice.call(pdvMenu.querySelectorAll("[data-gx-pdv]")); if(event.target.matches("[data-gx-pdv-all]")){ checks.forEach(function(c){c.checked=false;}); state.selectedPdvs=[]; } else { if(all) all.checked=false; state.selectedPdvs=checks.filter(function(c){return c.checked;}).map(function(c){return c.getAttribute("data-gx-pdv");}); } renderPdvMenu(); renderTable(); });
    document.addEventListener("click",function(event){ if(!event.target.closest("#gxPdvFilter")){ pdvMenu.hidden=true; pdvButton.setAttribute("aria-expanded","false"); } });
    document.getElementById("gxTbody").addEventListener("click",function(event){ var evidence=event.target.closest("[data-gx-evidence]"), start=event.target.closest("[data-gx-start-review]"), resolve=event.target.closest("[data-gx-resolve]"), close=event.target.closest("[data-gx-close-inline]"); if(evidence) openEvidence(evidence.getAttribute("data-gx-evidence")); if(start) startReview(start.getAttribute("data-gx-start-review")); if(resolve) openReview(resolve.getAttribute("data-gx-resolve")); if(close) hidePanel("review"); });
  });
})();
