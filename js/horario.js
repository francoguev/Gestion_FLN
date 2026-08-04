(function(){
  var state = { weekStart: mondayOf(new Date()), profile:null, roster:[], shifts:[], selected:null, selectedPdvs:[], copiedShift:null, copySourceShifts:[], loaded:false };
  var days = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  var monthNames = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

  function mondayOf(date){
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d;
  }
  function addDays(date, amount){ var d = new Date(date); d.setDate(d.getDate() + amount); return d; }
  function dateKey(date){
    return date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0");
  }
  function timeValue(value){ return value ? String(value).slice(0,5) : ""; }
  function clean(value){ return String(value || "").trim(); }
  function role(){ return clean(state.profile && state.profile.cargo).toLocaleLowerCase(); }
  function canEdit(){ return ["supervisor","operaciones"].indexOf(role()) !== -1; }
  function isAdvisor(){ return role() === "asesor"; }
  function escapeHtml(value){
    return String(value == null ? "" : value).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]; });
  }
  function weekDates(){ return days.map(function(_, index){ return addDays(state.weekStart, index); }); }
  function formatWeek(){
    var first = state.weekStart, last = addDays(first,6);
    var start = first.getDate()+" de "+monthNames[first.getMonth()];
    var end = last.getDate()+" de "+monthNames[last.getMonth()]+" de "+last.getFullYear();
    return start+" al "+end;
  }
  function selectedPdvs(){ return state.selectedPdvs || []; }
  function currentPdv(){ return selectedPdvs()[0] || ""; }
  function findShift(email, key){ return state.shifts.find(function(s){ return clean(s.advisor_email).toLowerCase()===clean(email).toLowerCase() && s.shift_date===key; }); }
  function minutesOf(time){ var parts=timeValue(time).split(":"); return parts.length===2 ? Number(parts[0])*60+Number(parts[1]) : 0; }
  function effectiveShiftMinutes(shift){
    if(!shift || shift.is_day_off || !shift.start_time || !shift.end_time) return 0;
    var total=Math.max(0,minutesOf(shift.end_time)-minutesOf(shift.start_time));
    if(shift.break_start && shift.break_end) total-=Math.max(0,minutesOf(shift.break_end)-minutesOf(shift.break_start));
    return Math.max(0,total);
  }
  function formatWeeklyHours(minutes){
    var hours=minutes/60;
    return (Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(".",","))+" h";
  }
  function exportTableToExcel(holderId,fileName){
    var table=document.querySelector("#"+holderId+" table");
    if(!table){ alert("Primero carga la tabla que deseas descargar."); return; }
    var copy=table.cloneNode(true);
    copy.querySelectorAll("button").forEach(function(button){ var text=document.createElement("span"); text.textContent=button.innerText; button.replaceWith(text); });
    var documentHtml='<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt}th,td{border:1px solid #b9b9c7;padding:7px;text-align:center}th{background:#3d1568;color:#fff;font-weight:bold}td:first-child{text-align:left}</style></head><body>'+copy.outerHTML+'</body></html>';
    var blob=new Blob(["\ufeff",documentHtml],{type:"application/vnd.ms-excel;charset=utf-8"});
    var link=document.createElement("a"); link.href=URL.createObjectURL(blob); link.download=fileName+".xls"; document.body.appendChild(link); link.click(); link.remove(); setTimeout(function(){URL.revokeObjectURL(link.href);},0);
  }
  var captureLoader=null;
  function loadHtml2Canvas(){
    if(window.html2canvas) return Promise.resolve(window.html2canvas);
    if(captureLoader) return captureLoader;
    captureLoader=new Promise(function(resolve,reject){
      var script=document.createElement("script"); script.src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
      script.onload=function(){resolve(window.html2canvas);}; script.onerror=function(){reject(new Error("No se pudo cargar el generador de capturas."));}; document.head.appendChild(script);
    });
    return captureLoader;
  }
  async function copyTableCapture(holderId,fileName,button){
    var table=document.querySelector("#"+holderId+" table");
    if(!table){ alert("Primero carga la tabla que deseas capturar."); return; }
    var original=button.textContent, stage=document.createElement("div"), copy=table.cloneNode(true);
    button.disabled=true; button.textContent="Generando…";
    try{
      copy.querySelectorAll("th:first-child,td:first-child").forEach(function(cell){cell.style.position="static";cell.style.boxShadow="none";});
      copy.style.width="max-content"; copy.style.minWidth="0";
      stage.style.cssText="position:fixed;left:-100000px;top:0;z-index:-1;background:#fff;padding:18px;width:max-content;max-width:none;";
      stage.appendChild(copy); document.body.appendChild(stage);
      var html2canvas=await loadHtml2Canvas();
      var canvas=await html2canvas(copy,{backgroundColor:"#ffffff",scale:2,useCORS:true,logging:false,width:copy.scrollWidth,height:copy.scrollHeight});
      var blob=await new Promise(function(resolve){canvas.toBlob(resolve,"image/png");}); if(!blob) throw new Error("No se pudo crear la imagen.");
      if(navigator.clipboard&&window.ClipboardItem){await navigator.clipboard.write([new ClipboardItem({"image/png":blob})]);button.textContent="¡Copiada!";}
      else{var link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=fileName+".png";document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(link.href);},0);button.textContent="Imagen descargada";}
    }catch(error){console.error(error);alert("No se pudo copiar la captura. Prueba desde la versión publicada con HTTPS.");}
    finally{if(stage.parentNode)stage.remove();setTimeout(function(){button.disabled=false;button.textContent=original;},1200);}
  }
  function setHint(text, isError){ var el=document.getElementById("horarioHint"); if(el){ el.textContent=text; el.style.color=isError ? "var(--bad)" : ""; } }

  async function loadProfile(){
    var user = window.currentUserProfile || {};
    if(!user.email || !window.supabaseClient) return false;
    var response = await window.supabaseClient.from("profiles").select("email, full_name, cargo, pdv").eq("email", user.email).maybeSingle();
    if(response.error) throw response.error;
    state.profile = response.data || { email:user.email, full_name:user.fullName || "", cargo:"", pdv:user.pdv || "" };
    return true;
  }
  async function loadRoster(){
    if(isAdvisor()){
      state.roster = [{ email:state.profile.email, full_name:state.profile.full_name || state.profile.email, pdv:state.profile.pdv || "Sin PDV" }];
      return;
    }
    var response = await window.supabaseClient.rpc("horario_roster");
    if(response.error) throw response.error;
    state.roster = response.data || [];
  }
  function populatePdvLegacy(){
    var select=document.getElementById("horarioPdvSelect");
    if(!select) return;
    var selected=select.value;
    var pdvs=Array.from(new Set(state.roster.map(function(p){ return clean(p.pdv); }).filter(Boolean))).sort();
    select.innerHTML = "";
    if(isAdvisor()){
      var only=document.createElement("option"); only.value=state.profile.pdv || ""; only.textContent="PDV · "+(state.profile.pdv || "Sin asignar"); select.appendChild(only); select.disabled=true;
    }else{
      var all=document.createElement("option"); all.value=""; all.textContent="PDV · Todos"; select.appendChild(all);
      pdvs.forEach(function(pdv){ var option=document.createElement("option"); option.value=pdv; option.textContent=pdv; select.appendChild(option); });
      select.value=pdvs.indexOf(selected)!==-1 ? selected : "";
      select.disabled=false;
    }
    document.getElementById("horarioCopyPrevious").style.display=canEdit()?"":"none";
  }
  function populatePdv(){
    var filter=document.getElementById("horarioPdvFilter"), button=document.getElementById("horarioPdvFilterButton"), menu=document.getElementById("horarioPdvFilterMenu");
    if(!filter || !button || !menu) return;
    var pdvs=Array.from(new Set(state.roster.map(function(p){ return clean(p.pdv); }).filter(Boolean))).sort();
    if(isAdvisor()){
      state.selectedPdvs=state.profile.pdv ? [state.profile.pdv] : [];
      button.textContent="PDV · "+(state.profile.pdv || "Sin asignar");
      button.disabled=true; menu.hidden=true;
    }else{
      state.selectedPdvs=selectedPdvs().filter(function(pdv){return pdvs.indexOf(pdv)!==-1;});
      menu.innerHTML='<label class="horario-pdv-all"><input type="checkbox" id="horarioPdvAll" '+(state.selectedPdvs.length===0?'checked':'')+'> Todos los PDV</label>'+pdvs.map(function(pdv){return '<label><input type="checkbox" data-horario-pdv="'+escapeHtml(pdv)+'" '+(state.selectedPdvs.indexOf(pdv)!==-1?'checked':'')+'> '+escapeHtml(pdv)+'</label>';}).join("");
      function updateLabel(){ var selected=selectedPdvs(); button.textContent=selected.length===0?'PDV · Todos':selected.length===1?'PDV · '+selected[0]:'PDV · '+selected.length+' seleccionados'; }
      updateLabel(); button.disabled=false;
      button.onclick=function(){ menu.hidden=!menu.hidden; button.setAttribute("aria-expanded",String(!menu.hidden)); };
      menu.querySelector("#horarioPdvAll").addEventListener("change",function(){ state.selectedPdvs=[]; menu.querySelectorAll("input[data-horario-pdv]").forEach(function(item){item.checked=false;}); updateLabel(); refresh(); });
      menu.querySelectorAll("input[data-horario-pdv]").forEach(function(item){ item.addEventListener("change",function(){ state.selectedPdvs=Array.from(menu.querySelectorAll("input[data-horario-pdv]:checked")).map(function(choice){return choice.dataset.horarioPdv;}); menu.querySelector("#horarioPdvAll").checked=state.selectedPdvs.length===0; updateLabel(); refresh(); }); });
    }
    document.getElementById("horarioCopyPrevious").style.display=canEdit()?"":"none";
  }
  async function loadShifts(){
    var from=dateKey(state.weekStart), to=dateKey(addDays(state.weekStart,6));
    var query=window.supabaseClient.from("horario_turnos").select("id, advisor_email, pdv, shift_date, start_time, end_time, break_start, break_end, is_day_off").gte("shift_date",from).lte("shift_date",to);
    var pdvs=selectedPdvs(); if(pdvs.length) query=query.in("pdv",pdvs);
    var response=await query;
    if(response.error) throw response.error;
    state.shifts=response.data || [];
  }
  function renderSchedule(){
    var holder=document.getElementById("horarioScheduleHolder"); if(!holder) return;
    var pdvs=selectedPdvs();
    var people=state.roster.filter(function(p){ return !pdvs.length || pdvs.indexOf(p.pdv)!==-1; });
    if(!people.length){ holder.innerHTML='<div class="horario-empty">No hay asesores asignados al PDV seleccionado.</div>'; return; }
    var header=weekDates().map(function(d,index){ return '<th>'+days[index]+'<br><small>'+d.getDate()+"/"+String(d.getMonth()+1).padStart(2,"0")+'</small></th>'; }).join("");
    var body=people.map(function(person){
      var cells=weekDates().map(function(date){
        var shift=findShift(person.email,dateKey(date));
        var content='Libre', extra='is-off';
        if(shift && !shift.is_day_off){ content=timeValue(shift.start_time)+'–'+timeValue(shift.end_time); extra=''; if(shift.break_start && shift.break_end) content+='<small>Ref. '+timeValue(shift.break_start)+'–'+timeValue(shift.break_end)+'</small>'; }
        var tag=canEdit()?'<button type="button" class="horario-shift '+extra+'" data-email="'+escapeHtml(person.email)+'" data-date="'+dateKey(date)+'">'+content+'</button>':'<div class="horario-shift '+extra+'">'+content+'</div>';
        return '<td>'+tag+'</td>';
      }).join("");
      var total=weekDates().reduce(function(sum,date){ return sum+effectiveShiftMinutes(findShift(person.email,dateKey(date))); },0);
      return '<tr><td>'+escapeHtml(person.full_name || person.email)+'<span class="horario-pdv-name">'+escapeHtml(person.pdv || "Sin PDV")+'</span></td>'+cells+'<td class="horario-week-total">'+formatWeeklyHours(total)+'</td></tr>';
    }).join("");
    holder.innerHTML='<table class="horario-table"><thead><tr><th>Asesor / PDV</th>'+header+'<th>Horas<br>semanales</th></tr></thead><tbody>'+body+'</tbody></table>';
    holder.querySelectorAll("button.horario-shift").forEach(function(button){ button.addEventListener("click",function(){ openEditor(button.dataset.email,button.dataset.date,button); }); });
  }
  function fillCoverageDays(){
    var select=document.getElementById("horarioCoverageDay"); if(!select) return;
    var old=select.value;
    select.innerHTML=weekDates().map(function(d,i){ return '<option value="'+dateKey(d)+'">'+days[i]+' '+d.getDate()+' de '+monthNames[d.getMonth()]+'</option>'; }).join("");
    select.value=old || dateKey(state.weekStart);
  }
  function inRange(hour, start, end){ return !!(start && end && hour >= Number(timeValue(start).split(":")[0]) && hour < Number(timeValue(end).split(":")[0])); }
  function renderCoverage(){
    var card=document.getElementById("horarioCoverageCard"), holder=document.getElementById("horarioCoverageHolder"); if(!card||!holder) return;
    card.hidden=isAdvisor(); if(isAdvisor()) return;
    fillCoverageDays();
    var date=document.getElementById("horarioCoverageDay").value, selected=selectedPdvs();
    var pdvs=Array.from(new Set(state.roster.map(function(p){return p.pdv;}).filter(Boolean))).filter(function(p){ return !selected.length || selected.indexOf(p)!==-1; }).sort();
    var hours=[]; for(var h=8;h<22;h++) hours.push(h);
    var head=hours.map(function(h){ return '<th>'+String(h).padStart(2,"0")+':00</th>'; }).join("");
    var rows=pdvs.map(function(pdv){
      var cells=hours.map(function(hour){
        var names=state.shifts.filter(function(s){
          if(s.pdv!==pdv || s.shift_date!==date || s.is_day_off || !inRange(hour,s.start_time,s.end_time)) return false;
          return !inRange(hour,s.break_start,s.break_end);
        }).map(function(s){ var person=state.roster.find(function(p){return clean(p.email).toLowerCase()===clean(s.advisor_email).toLowerCase();}); return person ? person.full_name : s.advisor_email; });
        var cls=names.length===0?"is-empty":names.length===1?"is-low":"is-good";
        return '<td class="horario-coverage-cell '+cls+'" title="'+escapeHtml(names.join(", ") || "Sin cobertura")+'">'+names.length+'</td>';
      }).join("");
      return '<tr><td>'+escapeHtml(pdv)+'</td>'+cells+'</tr>';
    }).join("");
    holder.innerHTML=rows?'<table class="horario-table"><thead><tr><th>PDV</th>'+head+'</tr></thead><tbody>'+rows+'</tbody></table>':'<div class="horario-empty">No hay PDV con asesores asignados.</div>';
  }
  function monthDates(){
    var first=new Date(state.weekStart.getFullYear(),state.weekStart.getMonth(),1), last=new Date(state.weekStart.getFullYear(),state.weekStart.getMonth()+1,0), result=[];
    for(var date=new Date(first);date<=last;date=addDays(date,1)) result.push(new Date(date));
    return result;
  }
  async function openMonthView(mode){
    var modal=document.getElementById("horarioMonthModal"), holder=document.getElementById("horarioMonthHolder"), title=document.getElementById("horarioMonthTitle"), hint=document.getElementById("horarioMonthHint"), dates=monthDates(), from=dateKey(dates[0]), to=dateKey(dates[dates.length-1]), selected=selectedPdvs();
    title.textContent=(mode==="schedule"?"Horario mensual":"Cobertura mensual por PDV")+" · "+monthNames[dates[0].getMonth()]+" "+dates[0].getFullYear();
    hint.textContent="Vista de solo lectura. Puedes usar Copiar captura para compartir el mes completo.";
    holder.innerHTML='<div class="horario-empty">Cargando vista mensual…</div>'; modal.hidden=false; modal.dataset.mode=mode;
    try{
      var query=window.supabaseClient.from("horario_turnos").select("advisor_email,pdv,shift_date,start_time,end_time,break_start,break_end,is_day_off").gte("shift_date",from).lte("shift_date",to);
      if(selected.length) query=query.in("pdv",selected);
      var response=await query; if(response.error) throw response.error;
      var shifts=response.data||[];
      if(mode==="schedule"){
        var people=state.roster.filter(function(person){return !selected.length||selected.indexOf(person.pdv)!==-1;});
        var head=dates.map(function(date){return '<th>'+days[(date.getDay()+6)%7].slice(0,3)+'<br><small>'+date.getDate()+"/"+String(date.getMonth()+1).padStart(2,"0")+'</small></th>';}).join("");
        var body=people.map(function(person){
          var total=0, cells=dates.map(function(date){var shift=shifts.find(function(item){return clean(item.advisor_email).toLowerCase()===clean(person.email).toLowerCase()&&item.shift_date===dateKey(date);});total+=effectiveShiftMinutes(shift);var text="Libre",cls="is-off";if(shift&&!shift.is_day_off){text=timeValue(shift.start_time)+"–"+timeValue(shift.end_time);cls="";if(shift.break_start&&shift.break_end)text+='<small>Ref. '+timeValue(shift.break_start)+"–"+timeValue(shift.break_end)+"</small>";}return '<td><div class="horario-shift '+cls+'">'+text+'</div></td>';}).join("");
          return '<tr><td>'+escapeHtml(person.full_name||person.email)+'<span class="horario-pdv-name">'+escapeHtml(person.pdv||"Sin PDV")+'</span></td>'+cells+'<td class="horario-week-total">'+formatWeeklyHours(total)+'</td></tr>';
        }).join("");
        holder.innerHTML=body?'<table class="horario-table horario-month-table"><thead><tr><th>Asesor / PDV</th>'+head+'<th>Horas<br>mensuales</th></tr></thead><tbody>'+body+'</tbody></table>':'<div class="horario-empty">No hay asesores para el filtro seleccionado.</div>';
      }else{
        var pdvs=Array.from(new Set(state.roster.map(function(person){return person.pdv;}).filter(Boolean))).filter(function(pdv){return !selected.length||selected.indexOf(pdv)!==-1;}).sort();
        var coverageHead=dates.map(function(date){return '<th>'+days[(date.getDay()+6)%7].slice(0,3)+'<br><small>'+date.getDate()+"/"+String(date.getMonth()+1).padStart(2,"0")+'</small></th>';}).join("");
        var coverageRows=pdvs.map(function(pdv){
          var cells=dates.map(function(date){var hours=0;for(var hour=8;hour<22;hour++){var count=shifts.filter(function(shift){return shift.pdv===pdv&&shift.shift_date===dateKey(date)&&!shift.is_day_off&&inRange(hour,shift.start_time,shift.end_time)&&!inRange(hour,shift.break_start,shift.break_end);}).length;hours+=count;}var cls=hours===0?"is-empty":hours<10?"is-low":"is-good";return '<td class="horario-coverage-cell '+cls+'" title="'+hours+' horas-persona de cobertura">'+hours+' h</td>';}).join("");
          return '<tr><td>'+escapeHtml(pdv)+'</td>'+cells+'</tr>';
        }).join("");
        holder.innerHTML=coverageRows?'<table class="horario-table horario-month-table"><thead><tr><th>PDV</th>'+coverageHead+'</tr></thead><tbody>'+coverageRows+'</tbody></table>':'<div class="horario-empty">No hay PDV para el filtro seleccionado.</div>';
      }
    }catch(error){console.error(error);holder.innerHTML='<div class="horario-empty">No se pudo cargar la vista mensual.</div>';}
  }
  function closeMonthView(){document.getElementById("horarioMonthModal").hidden=true;}
  function moveEditorHome(){
    var editor=document.getElementById("horarioEditor");
    var editorRow=editor && editor.closest("tr.horario-editor-row");
    if(editorRow){
      document.querySelector("#page-horario .horario-wrap").appendChild(editor);
      editorRow.remove();
    }
  }
  function openEditor(email,key,sourceButton){
    var person=state.roster.find(function(p){return clean(p.email).toLowerCase()===clean(email).toLowerCase();}); if(!person) return;
    state.selected={email:email,date:key,pdv:person.pdv}; var shift=findShift(email,key);
    var editor=document.getElementById("horarioEditor");
    moveEditorHome();
    editor.hidden=false;
    var row=document.createElement("tr"), cell=document.createElement("td");
    row.className="horario-editor-row";
    cell.colSpan=9;
    cell.appendChild(editor);
    row.appendChild(cell);
    if(sourceButton && sourceButton.closest("tr")) sourceButton.closest("tr").insertAdjacentElement("afterend",row);
    document.getElementById("horarioEditorLabel").textContent=(person.full_name || email)+" · "+key+" · "+(person.pdv || "Sin PDV");
    document.getElementById("horarioStartTime").value=shift&&!shift.is_day_off?timeValue(shift.start_time):"";
    document.getElementById("horarioEndTime").value=shift&&!shift.is_day_off?timeValue(shift.end_time):"";
    document.getElementById("horarioBreakStart").value=shift&&!shift.is_day_off?timeValue(shift.break_start):"";
    document.getElementById("horarioBreakEnd").value=shift&&!shift.is_day_off?timeValue(shift.break_end):"";
    if(sourceButton) sourceButton.scrollIntoView({behavior:"smooth",block:"nearest"});
  }
  function closeEditor(){ state.selected=null; var editor=document.getElementById("horarioEditor"); if(editor) editor.hidden=true; }
  function copyEditorShift(){
    if(!state.selected){ alert("Selecciona un día en la tabla para copiar."); return; }
    var shift=findShift(state.selected.email,state.selected.date);
    state.copiedShift={start:shift&&shift.start_time?timeValue(shift.start_time):document.getElementById("horarioStartTime").value,end:shift&&shift.end_time?timeValue(shift.end_time):document.getElementById("horarioEndTime").value,breakStart:shift&&shift.break_start?timeValue(shift.break_start):document.getElementById("horarioBreakStart").value,breakEnd:shift&&shift.break_end?timeValue(shift.break_end):document.getElementById("horarioBreakEnd").value};
    document.getElementById("horarioPasteShift").disabled=false;
    document.getElementById("horarioPasteShift").title="Pegar el horario copiado y guardarlo.";
    alert("Horario copiado. Puedes pegarlo en todos los días que estén Libres.");
  }
  async function pasteCopiedShift(){
    if(!state.copiedShift){ alert("Primero copia un horario configurado."); return; }
    await saveEditor(false,state.copiedShift);
  }
  async function saveEditor(off,copied){
    if(!state.selected) return;
    var start=copied ? copied.start : document.getElementById("horarioStartTime").value, end=copied ? copied.end : document.getElementById("horarioEndTime").value;
    var breakStart=copied ? copied.breakStart : document.getElementById("horarioBreakStart").value, breakEnd=copied ? copied.breakEnd : document.getElementById("horarioBreakEnd").value;
    if(!off && (!start || !end || end<=start)){ alert("Indica una hora de ingreso y una salida posterior."); return; }
    if(!off && ((breakStart&&!breakEnd)||(!breakStart&&breakEnd)||(breakStart&&breakEnd&&breakEnd<=breakStart))){ alert("Completa correctamente el rango de refrigerio."); return; }
    var payload={advisor_email:state.selected.email,pdv:state.selected.pdv,shift_date:state.selected.date,is_day_off:!!off,start_time:off?null:start,end_time:off?null:end,break_start:off?null:(breakStart||null),break_end:off?null:(breakEnd||null),updated_by:state.profile.email,updated_at:new Date().toISOString()};
    var response=await window.supabaseClient.from("horario_turnos").upsert(payload,{onConflict:"advisor_email,shift_date"});
    if(response.error) throw response.error;
    closeEditor(); await refresh();
  }
  async function copyPreviousLegacy(){
    var pdv=currentPdv(); if(!pdv){ alert("Primero selecciona un PDV para copiar su semana anterior."); return; }
    if(!confirm("¿Copiar la semana anterior para "+pdv+"? Los días existentes se actualizarán.")) return;
    var previous=mondayOf(addDays(state.weekStart,-7));
    var response=await window.supabaseClient.from("horario_turnos").select("advisor_email,pdv,shift_date,start_time,end_time,break_start,break_end,is_day_off,shift_type").eq("pdv",pdv).gte("shift_date",dateKey(previous)).lte("shift_date",dateKey(addDays(previous,6)));
    if(response.error) throw response.error;
    var payload=(response.data||[]).map(function(s){ var shifted=addDays(new Date(s.shift_date+"T12:00:00"),7); s.shift_date=dateKey(shifted); s.updated_by=state.profile.email; s.updated_at=new Date().toISOString(); return s; });
    if(!payload.length){ alert("No hay turnos en la semana anterior para copiar."); return; }
    var saved=await window.supabaseClient.from("horario_turnos").upsert(payload,{onConflict:"advisor_email,shift_date"}); if(saved.error) throw saved.error;
    await refresh();
  }
  async function copyPrevious(){
    await openCopyDialog();
  }
  function formatCopyWeek(first){
    var last=addDays(first,6);
    return first.getDate()+" de "+monthNames[first.getMonth()]+" al "+last.getDate()+" de "+monthNames[last.getMonth()];
  }
  function closeCopyDialog(){ document.getElementById("horarioCopyModal").hidden=true; }
  function renderCopyTree(){
    var tree=document.getElementById("horarioCopyTree"), names={};
    state.roster.forEach(function(person){ names[clean(person.email).toLowerCase()]=person.full_name || person.email; });
    var grouped={};
    state.copySourceShifts.forEach(function(shift){
      var pdv=clean(shift.pdv) || "Sin PDV", email=clean(shift.advisor_email), key=email.toLowerCase();
      if(!grouped[pdv]) grouped[pdv]={};
      grouped[pdv][key]={email:email,name:names[key] || email};
    });
    var pdvs=Object.keys(grouped).sort();
    if(!pdvs.length){ tree.innerHTML='<div class="horario-empty">No hay horarios registrados en la semana anterior.</div>'; return; }
    tree.innerHTML=pdvs.map(function(pdv,index){
      var advisors=Object.keys(grouped[pdv]).sort(function(a,b){ return grouped[pdv][a].name.localeCompare(grouped[pdv][b].name); });
      var rows=advisors.map(function(key){ var person=grouped[pdv][key]; return '<label class="horario-copy-advisor"><input type="checkbox" data-copy-advisor="true" data-pdv-index="'+index+'" data-email="'+escapeHtml(person.email)+'" checked> '+escapeHtml(person.name)+'</label>'; }).join("");
      return '<details class="horario-copy-pdv" open><summary><label><input type="checkbox" data-copy-pdv="true" data-pdv-index="'+index+'" checked> <strong>'+escapeHtml(pdv)+'</strong> <span>'+advisors.length+' asesor(es)</span></label></summary><div>'+rows+'</div></details>';
    }).join("");
    tree.querySelectorAll("input[data-copy-pdv]").forEach(function(parent){ parent.addEventListener("change",function(){ tree.querySelectorAll('input[data-copy-advisor][data-pdv-index="'+parent.dataset.pdvIndex+'"]').forEach(function(child){ child.checked=parent.checked; }); }); });
    tree.querySelectorAll("input[data-copy-advisor]").forEach(function(child){ child.addEventListener("change",function(){ var siblings=tree.querySelectorAll('input[data-copy-advisor][data-pdv-index="'+child.dataset.pdvIndex+'"]'); var parent=tree.querySelector('input[data-copy-pdv][data-pdv-index="'+child.dataset.pdvIndex+'"]'); var count=Array.from(siblings).filter(function(item){return item.checked;}).length; parent.checked=count===siblings.length; parent.indeterminate=count>0&&count<siblings.length; }); });
  }
  async function openCopyDialog(){
    var previous=mondayOf(addDays(state.weekStart,-7));
    var modal=document.getElementById("horarioCopyModal"), status=document.getElementById("horarioCopyStatus");
    document.getElementById("horarioCopyWeekText").textContent=formatCopyWeek(previous);
    document.getElementById("horarioCopyTargetText").textContent=formatCopyWeek(state.weekStart);
    document.getElementById("horarioCopyTree").innerHTML='<div class="horario-empty">Cargando turnos de la semana anterior…</div>';
    status.textContent=""; modal.hidden=false;
    var response=await window.supabaseClient.from("horario_turnos").select("advisor_email,pdv,shift_date,start_time,end_time,break_start,break_end,is_day_off").gte("shift_date",dateKey(previous)).lte("shift_date",dateKey(addDays(previous,6)));
    if(response.error) throw response.error;
    state.copySourceShifts=response.data || [];
    renderCopyTree();
    status.textContent=state.copySourceShifts.length ? "Los turnos existentes de los asesores seleccionados se actualizarán." : "";
  }
  async function confirmPreviousCopy(){
    var selected=Array.from(document.querySelectorAll("#horarioCopyTree input[data-copy-advisor]:checked")).map(function(item){ return clean(item.dataset.email).toLowerCase(); });
    if(!selected.length){ alert("Selecciona al menos un asesor."); return; }
    var chosen=state.copySourceShifts.filter(function(shift){ return selected.indexOf(clean(shift.advisor_email).toLowerCase())!==-1; });
    var payload=chosen.map(function(shift){ return {advisor_email:shift.advisor_email,pdv:shift.pdv,shift_date:dateKey(addDays(new Date(shift.shift_date+"T12:00:00"),7)),start_time:shift.start_time,end_time:shift.end_time,break_start:shift.break_start,break_end:shift.break_end,is_day_off:shift.is_day_off,updated_by:state.profile.email,updated_at:new Date().toISOString()}; });
    var status=document.getElementById("horarioCopyStatus"); status.textContent="Copiando "+payload.length+" turno(s)…";
    var saved=await window.supabaseClient.from("horario_turnos").upsert(payload,{onConflict:"advisor_email,shift_date"});
    if(saved.error) throw saved.error;
    closeCopyDialog(); await refresh();
  }
  async function refresh(){
    var currentWeek = dateKey(state.weekStart) === dateKey(mondayOf(new Date()));
    document.getElementById("horarioWeekLabel").textContent=(currentWeek ? "Semana actual · " : "Semana del ")+formatWeek();
    try{
      setHint("Cargando turnos…"); await loadShifts(); renderSchedule(); renderCoverage(); setHint(isAdvisor()?"Tu horario para la semana seleccionada.":"Selecciona un turno para editarlo o revisa la cobertura por hora.");
    }catch(error){ console.error("Horario:",error); document.getElementById("horarioScheduleHolder").innerHTML='<div class="horario-empty">Aún no se puede cargar Horario. Ejecuta primero <strong>supabase/003_horarios.sql</strong> en el SQL Editor de Supabase.</div>'; setHint("Falta crear la tabla y las políticas de Horario en Supabase.",true); }
  }
  async function init(){
    if(state.loaded) return refresh();
    try{ await loadProfile(); await loadRoster(); populatePdv(); state.loaded=true; await refresh(); }
    catch(error){ console.error("Inicialización de Horario:",error); document.getElementById("horarioScheduleHolder").innerHTML='<div class="horario-empty">Aún no se puede iniciar Horario. Ejecuta <strong>supabase/003_horarios.sql</strong> en Supabase.</div>'; setHint("Falta crear la estructura de Horario en Supabase.",true); }
  }
  window.loadHorario=init;
  document.addEventListener("DOMContentLoaded",function(){
    document.getElementById("horarioPrevWeek").addEventListener("click",function(){state.weekStart=addDays(state.weekStart,-7);refresh();});
    document.getElementById("horarioNextWeek").addEventListener("click",function(){state.weekStart=addDays(state.weekStart,7);refresh();});
    document.getElementById("horarioWeekLabel").addEventListener("click",function(){state.weekStart=mondayOf(new Date());refresh();});
    document.addEventListener("click",function(event){ var filter=document.getElementById("horarioPdvFilter"), menu=document.getElementById("horarioPdvFilterMenu"), button=document.getElementById("horarioPdvFilterButton"); if(filter && !filter.contains(event.target) && !menu.hidden){ menu.hidden=true; button.setAttribute("aria-expanded","false"); } });
    document.getElementById("horarioCoverageDay").addEventListener("change",renderCoverage);
    document.getElementById("horarioExportSchedule").addEventListener("click",function(){ exportTableToExcel("horarioScheduleHolder","horario-semanal-"+dateKey(state.weekStart)); });
    document.getElementById("horarioExportCoverage").addEventListener("click",function(){ var day=document.getElementById("horarioCoverageDay").value || dateKey(state.weekStart); exportTableToExcel("horarioCoverageHolder","cobertura-pdv-"+day); });
    document.getElementById("horarioCaptureSchedule").addEventListener("click",function(){ copyTableCapture("horarioScheduleHolder","horario-semanal-"+dateKey(state.weekStart),this); });
    document.getElementById("horarioCaptureCoverage").addEventListener("click",function(){ var day=document.getElementById("horarioCoverageDay").value || dateKey(state.weekStart); copyTableCapture("horarioCoverageHolder","cobertura-pdv-"+day,this); });
    document.getElementById("horarioMonthSchedule").addEventListener("click",function(){openMonthView("schedule");});
    document.getElementById("horarioMonthCoverage").addEventListener("click",function(){openMonthView("coverage");});
    document.getElementById("horarioMonthClose").addEventListener("click",closeMonthView);
    document.getElementById("horarioMonthCloseBottom").addEventListener("click",closeMonthView);
    document.getElementById("horarioMonthCapture").addEventListener("click",function(){var mode=document.getElementById("horarioMonthModal").dataset.mode||"mes";copyTableCapture("horarioMonthHolder","horario-"+mode+"-mensual-"+dateKey(state.weekStart),this);});
    document.getElementById("horarioMonthExport").addEventListener("click",function(){var mode=document.getElementById("horarioMonthModal").dataset.mode||"mes";exportTableToExcel("horarioMonthHolder","horario-"+mode+"-mensual-"+dateKey(state.weekStart));});
    document.getElementById("horarioCancelEdit").addEventListener("click",closeEditor);
    document.getElementById("horarioCopyShift").addEventListener("click",copyEditorShift);
    document.getElementById("horarioPasteShift").addEventListener("click",function(){pasteCopiedShift().catch(function(e){alert("No se pudo pegar: "+e.message);});});
    document.getElementById("horarioSaveEdit").addEventListener("click",function(){saveEditor(false).catch(function(e){alert("No se pudo guardar: "+e.message);});});
    document.getElementById("horarioCopyPrevious").addEventListener("click",function(){copyPrevious().catch(function(e){alert("No se pudo copiar: "+e.message);});});
    document.getElementById("horarioCopyCancel").addEventListener("click",closeCopyDialog);
    document.getElementById("horarioCopyCancelBottom").addEventListener("click",closeCopyDialog);
    document.getElementById("horarioCopyConfirm").addEventListener("click",function(){confirmPreviousCopy().catch(function(e){alert("No se pudo copiar: "+e.message);});});
    document.querySelectorAll(".horario-preset").forEach(function(button){ button.addEventListener("click",function(){ var off=button.dataset.off==="true"; if(off){ saveEditor(true).catch(function(e){alert("No se pudo guardar: "+e.message);}); return; } document.getElementById("horarioStartTime").value=button.dataset.start; document.getElementById("horarioEndTime").value=button.dataset.end; }); });
  });
})();
