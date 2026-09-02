(function(){
  var state = {
    weekStart: mondayOf(new Date()),
    profile: null,
    roster: [],
    shifts: [],
    selected: null,
    copiedShift: null,
    officialPdvs: [],
    loaded: false
  };

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
  function role(){ return clean(state.profile && state.profile.cargo).toLowerCase(); }
  function isAdmOrSup(){
    var r = role();
    var isAdm = state.profile && (state.profile.es_administrador === true || r === "administrador");
    return isAdm || r === "supervisor" || r === "gestor" || r === "operaciones" || r === "gerente";
  }

  function escapeHtml(value){
    return String(value == null ? "" : value).replace(/[&<>"']/g,function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];
    });
  }

  function weekDates(){ return days.map(function(_, index){ return addDays(state.weekStart, index); }); }
  function formatWeek(){
    var first = state.weekStart, last = addDays(first,6);
    var start = first.getDate()+" de "+monthNames[first.getMonth()];
    var end = last.getDate()+" de "+monthNames[last.getMonth()]+" de "+last.getFullYear();
    return start+" al "+end;
  }

  function findShift(email, key){
    return state.shifts.find(function(s){
      return clean(s.leader_email).toLowerCase() === clean(email).toLowerCase() && s.shift_date === key;
    });
  }

  function calcVisitHours(start, end){
    if(!start || !end || end <= start) return 0;
    var s = start.split(":").map(Number);
    var e = end.split(":").map(Number);
    var mins = (e[0]*60 + e[1]) - (s[0]*60 + s[1]);
    return Math.max(0, mins / 60);
  }

  function getShiftTotalHours(shift){
    if(!shift || shift.is_day_off) return 0;
    var pdvs = shift.pdvs || [];
    var total = 0;
    pdvs.forEach(function(item){
      var match = item.match(/\((\d{2}:\d{2})-(\d{2}:\d{2})\)/);
      if(match){
        total += calcVisitHours(match[1], match[2]);
      }
    });
    if(total > 0) return total;
    if(shift.start_time && shift.end_time){
      return calcVisitHours(timeValue(shift.start_time), timeValue(shift.end_time));
    }
    return 0;
  }

  function formatWeeklyHours(hours){
    if(hours <= 0) return "0 h";
    return (Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(".",",")) + " h";
  }

  function exportTableToExcel(holderId, fileName){
    var table = document.querySelector("#" + holderId + " table");
    if(!table){ alert("Primero carga la tabla que deseas descargar."); return; }
    var copy = table.cloneNode(true);
    copy.querySelectorAll("button").forEach(function(button){
      var text = document.createElement("span");
      text.textContent = button.innerText;
      button.replaceWith(text);
    });
    var documentHtml = '<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt}th,td{border:1px solid #b9b9c7;padding:7px;text-align:center}th{background:#1e3a8a;color:#fff;font-weight:bold}td:first-child{text-align:left}</style></head><body>' + copy.outerHTML + '</body></html>';
    var blob = new Blob(["\ufeff", documentHtml], {type:"application/vnd.ms-excel;charset=utf-8"});
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName + ".xls";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function(){ URL.revokeObjectURL(link.href); }, 0);
  }

  var captureLoader = null;
  function loadHtml2Canvas(){
    if(window.html2canvas) return Promise.resolve(window.html2canvas);
    if(captureLoader) return captureLoader;
    captureLoader = new Promise(function(resolve, reject){
      var script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
      script.onload = function(){ resolve(window.html2canvas); };
      script.onerror = function(){ reject(new Error("No se pudo cargar el generador de capturas.")); };
      document.head.appendChild(script);
    });
    return captureLoader;
  }

  async function copyTableCapture(holderId, fileName, button){
    var table = document.querySelector("#" + holderId + " table");
    if(!table){ alert("Primero carga la tabla que deseas capturar."); return; }
    var original = button.textContent, stage = document.createElement("div"), copy = table.cloneNode(true);
    button.disabled = true; button.textContent = "Generando…";
    try{
      copy.querySelectorAll("th:first-child,td:first-child").forEach(function(cell){
        cell.style.position = "static"; cell.style.boxShadow = "none";
      });
      copy.style.width = "max-content"; copy.style.minWidth = "0";
      stage.style.cssText = "position:fixed;left:-100000px;top:0;z-index:-1;background:#fff;padding:18px;width:max-content;max-width:none;";
      stage.appendChild(copy); document.body.appendChild(stage);
      var html2canvas = await loadHtml2Canvas();
      var canvas = await html2canvas(copy, {backgroundColor:"#ffffff", scale:2, useCORS:true, logging:false, width:copy.scrollWidth, height:copy.scrollHeight});
      var blob = await new Promise(function(resolve){ canvas.toBlob(resolve, "image/png"); });
      if(!blob) throw new Error("No se pudo crear la imagen.");
      if(navigator.clipboard && window.ClipboardItem){
        await navigator.clipboard.write([new ClipboardItem({"image/png": blob})]);
        button.textContent = "¡Copiada!";
      }else{
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = fileName + ".png";
        document.body.appendChild(link);
        link.click(); link.remove();
        setTimeout(function(){ URL.revokeObjectURL(link.href); }, 0);
        button.textContent = "Imagen descargada";
      }
    }catch(error){
      console.error(error);
      alert("No se pudo copiar la captura imagen.");
    }finally{
      if(stage.parentNode) stage.remove();
      setTimeout(function(){ button.disabled = false; button.textContent = original; }, 1200);
    }
  }

  function setHint(text, isError){
    var el = document.getElementById("hlHint");
    if(el){ el.textContent = text; el.style.color = isError ? "var(--bad)" : ""; }
  }

  async function loadOfficialPdvs(){
    try{
      if(window.supabaseClient){
        var res = await window.supabaseClient.from("profiles").select("pdv");
        if(res && res.data){
          var set = { "REMOTO": true, "OFICINA": true, "RUTA": true, "CAPACITACIÓN": true };
          res.data.forEach(function(r){ if(r.pdv && r.pdv.trim()) set[r.pdv.trim()] = true; });
          var list = Object.keys(set).sort();
          if(list.length > 0){ state.officialPdvs = list; return; }
        }
      }
    }catch(e){}
    state.officialPdvs = [
      "TE AYACUCHO", "TE HUANTA", "TE ICA", "TE ICA 3", "TE ICA II",
      "TE ICA MODELO", "TE NAZCA", "TE PARCONA", "TE PISCO",
      "TE SATELITE BARRIO CHINO", "TE SATELITE CAÑETE", "TE SATELITE CHALA",
      "TE SATELITE PALPA", "TE SATELITE PUEBLO JOVEN", "OFICINA", "REMOTO", "RUTA", "CAPACITACIÓN"
    ];
  }

  async function loadProfile(){
    var user = window.currentUserProfile || {};
    var email = user.email || "operaciones.fortalecernos@gmail.com";
    try{
      if(window.supabaseClient && email){
        var response = await window.supabaseClient.from("profiles").select("email, full_name, cargo, pdv, es_administrador").ilike("email", email).maybeSingle();
        if(!response.error && response.data){
          state.profile = response.data;
          if(user.es_administrador !== undefined) state.profile.es_administrador = user.es_administrador;
          if(user.cargo) state.profile.cargo = user.cargo;
          return true;
        }
      }
    }catch(e){}

    state.profile = { email: email, full_name: user.fullName || email, cargo: user.cargo || "operaciones", es_administrador: !!user.es_administrador };
    return true;
  }

  async function loadRoster(){
    try{
      var client = window.supabaseClient;
      if(client){
        var res = await client.from("profiles")
          .select("email, full_name, cargo, pdv, es_administrador, activo")
          .order("full_name", { ascending: true });
        if(!res.error && res.data && res.data.length > 0){
          var all = res.data || [];
          state.roster = all.filter(function(p){
            var c = (p.cargo || "").trim().toLowerCase();
            var isLeaderCargo = c.indexOf("supervisor") !== -1 || c.indexOf("gestor") !== -1 || c === "lider" || c === "líder";
            return isLeaderCargo && p.activo !== false;
          });
          if(state.roster.length > 0) return;
        }
      }
    }catch(e){
      console.error("Excepción en loadRoster:", e);
    }

    state.roster = [
      { email: "lisbethguerra.fortalecernos@gmail.com", full_name: "Cynthia Guerra", cargo: "Supervisor", pdv: "TE ICA" },
      { email: "fln.jmoreno@gmail.com", full_name: "Fernando Moreno", cargo: "Supervisor", pdv: "TE CHINCHA" },
      { email: "fln.mbernaola@gmail.com", full_name: "María Bernaola", cargo: "Supervisor", pdv: "" },
      { email: "merlz2003@gmal.com", full_name: "Mery Lapa Zarate", cargo: "Supervisor", pdv: "" },
      { email: "sheylaflores.fortalecernos@gmail.com", full_name: "Sheyla Flores", cargo: "Gestor", pdv: "" }
    ];
  }

  async function loadShifts(){
    var from = dateKey(state.weekStart), to = dateKey(addDays(state.weekStart, 6));
    try{
      if(window.supabaseClient){
        var response = await window.supabaseClient.from("horario_lideres")
          .select("id, leader_email, leader_name, cargo, shift_date, start_time, end_time, break_start, break_end, is_day_off, pdvs, notas")
          .gte("shift_date", from)
          .lte("shift_date", to);
        if(!response.error && response.data){
          state.shifts = response.data || [];
          return;
        }
      }
    }catch(e){}
  }

  function canSeeAllRoster(){
    if(!state.profile) return false;
    var isAdm = state.profile.es_administrador === true || role() === "administrador";
    var r = role();

    // 1. Administrador (o usuario con es_administrador === true) -> Ve TODOS los horarios de supervisores y gestores
    if(isAdm) return true;

    // 2. Gerente (sin perfil admin) -> Ve TODOS los horarios de supervisores y gestores
    if(r === "gerente") return true;

    // 3. Gestor o Supervisor (sin perfil admin) -> Solo ven su PROPIO horario
    // 4. Operaciones (sin perfil admin) -> NO ve todos los horarios
    return false;
  }

  function canEditShift(shiftEmail){
    if(!state.profile) return false;
    var isAdm = state.profile.es_administrador === true || role() === "administrador";
    var myEmail = clean(state.profile.email).toLowerCase();
    var targetEmail = clean(shiftEmail).toLowerCase();

    // Administrador -> Puede editar el horario de cualquiera
    if(isAdm) return true;

    // El propio líder (Supervisor o Gestor) -> Puede editar su propio horario
    if(myEmail === targetEmail) return true;

    // Otros cargos (Gerente o personas sin permiso de edicion) -> Solo vista
    return false;
  }

  function renderPdvBadges(pdvsArray){
    if(!pdvsArray || !pdvsArray.length) return '';
    var items = pdvsArray.filter(Boolean);
    if(!items.length) return '';
    return '<div class="hl-pdv-badges">' +
      items.map(function(p){
        return '<span class="hl-pdv-badge" title="Tienda/Ubicación visitada">📍 ' + escapeHtml(p) + '</span>';
      }).join('') +
      '</div>';
  }

  function renderSchedule(){
    var holder = document.getElementById("hlScheduleHolder"); if(!holder) return;
    moveEditorHome();
    var allPeople = state.roster;
    if(!allPeople.length){
      holder.innerHTML = '<div class="horario-empty">No hay supervisores o gestores registrados.</div>';
      return;
    }

    var showAll = canSeeAllRoster();
    var currentUserEmail = clean(state.profile ? state.profile.email : "").toLowerCase();

    var people = allPeople;
    if(!showAll){
      people = allPeople.filter(function(p){
        return clean(p.email).toLowerCase() === currentUserEmail;
      });
    }

    if(!people.length){
      holder.innerHTML = '<div class="horario-empty" style="padding:40px; text-align:center; color:#64748b; font-weight:600;">No tienes permisos para visualizar otros horarios de líderes.</div>';
      return;
    }

    var header = weekDates().map(function(d, index){
      return '<th>' + days[index] + '<br><small>' + d.getDate() + "/" + String(d.getMonth()+1).padStart(2,"0") + '</small></th>';
    }).join("");

    var body = people.map(function(person){
      var weeklyTotalHours = 0;

      var cells = weekDates().map(function(date){
        var key = dateKey(date);
        var shift = findShift(person.email, key);
        var content = 'Libre', extra = 'is-off';
        var pdvBadges = '';

        if(shift && !shift.is_day_off){
          var dailyHrs = getShiftTotalHours(shift);
          weeklyTotalHours += dailyHrs;
          extra = '';
          content = dailyHrs > 0 ? (dailyHrs.toFixed(1).replace(".",",") + ' h') : (timeValue(shift.start_time) + '–' + timeValue(shift.end_time));

          if(shift.pdvs && shift.pdvs.length){
            pdvBadges = renderPdvBadges(shift.pdvs);
          }
        }

        var editable = canEditShift(person.email);

        var tag = editable
          ? '<button type="button" class="horario-shift ' + extra + '" data-email="' + escapeHtml(person.email) + '" data-date="' + key + '">' + content + pdvBadges + '</button>'
          : '<div class="horario-shift ' + extra + '">' + content + pdvBadges + '</div>';

        return '<td>' + tag + '</td>';
      }).join("");

      var cargoLabel = (person.cargo || "Líder").toUpperCase();

      return '<tr><td>' + escapeHtml(person.full_name || person.email) + '<span class="horario-pdv-name">' + escapeHtml(cargoLabel) + '</span></td>' + cells + '<td class="horario-week-total">' + formatWeeklyHours(weeklyTotalHours) + '</td></tr>';
    }).join("");

    holder.innerHTML = '<table class="horario-table"><thead><tr><th>Líder / Cargo</th>' + header + '<th>Horas<br>semanales</th></tr></thead><tbody>' + body + '</tbody></table>';

    holder.querySelectorAll("button.horario-shift").forEach(function(button){
      button.addEventListener("click", function(){
        openEditor(button.dataset.email, button.dataset.date, button);
      });
    });
  }

  function parseVisitsFromShift(shift){
    if(!shift || shift.is_day_off) return [];
    var pdvs = shift.pdvs || [];
    var visits = [];
    pdvs.forEach(function(item){
      var match = item.match(/^(.*?)(?:\s*\((\d{2}:\d{2})-(\d{2}:\d{2})\))?$/);
      if(match){
        var pdvName = (match[1] || "").trim();
        var start = match[2] || (shift.start_time ? timeValue(shift.start_time) : "09:00");
        var end = match[3] || (shift.end_time ? timeValue(shift.end_time) : "18:00");
        visits.push({ pdv: pdvName, start: start, end: end });
      }
    });
    if(!visits.length && shift.start_time && shift.end_time){
      visits.push({
        pdv: (pdvs[0] || ""),
        start: timeValue(shift.start_time),
        end: timeValue(shift.end_time)
      });
    }
    return visits;
  }

  function renderVisitsEditor(visits){
    visits = visits || [];
    if(!visits.length){
      visits = [{ pdv: "", start: "09:00", end: "18:00" }];
    }

    var container = document.getElementById("hlVisitsContainer");
    if(!container) return;

    var html = visits.map(function(v, idx){
      var pdvOpts = '<option value="">(Selecciona Tienda / Ubicación)</option>' +
        state.officialPdvs.map(function(p){
          return '<option value="' + escapeHtml(p) + '"' + (p === v.pdv ? ' selected' : '') + '>' + escapeHtml(p) + '</option>';
        }).join('');

      var hrs = calcVisitHours(v.start, v.end);
      var hrsBadge = hrs > 0 ? '<span style="font-size:11px; font-weight:700; color:#1d4ed8; background:#eff6ff; padding:2px 8px; border-radius:6px; border:1px solid #bfdbfe;">' + hrs.toFixed(1) + ' hrs</span>' : '';

      return '<div class="hl-visit-card" data-index="' + idx + '">' +
        '<div>' +
          '<label style="font-size:11px; font-weight:700; color:#475569; display:flex; align-items:center; gap:6px; margin-bottom:4px;">TIENDA / UBICACIÓN N°' + (idx+1) + ' ' + hrsBadge + '</label>' +
          '<select class="hl-visit-pdv-select" style="width:100%;">' + pdvOpts + '</select>' +
        '</div>' +
        '<div>' +
          '<label style="font-size:11px; font-weight:700; color:#475569; display:block; margin-bottom:4px;">HORA INICIO</label>' +
          '<input type="time" class="hl-visit-start-inp" value="' + (v.start || '09:00') + '">' +
        '</div>' +
        '<div>' +
          '<label style="font-size:11px; font-weight:700; color:#475569; display:block; margin-bottom:4px;">HORA FIN</label>' +
          '<input type="time" class="hl-visit-end-inp" value="' + (v.end || '18:00') + '">' +
        '</div>' +
        '<div style="padding-top:16px;">' +
          '<button type="button" class="hl-remove-visit-btn" data-index="' + idx + '" title="Eliminar esta visita">🗑️</button>' +
        '</div>' +
      '</div>';
    }).join('');

    container.innerHTML = html;

    recalcTotalDailyHours();

    container.querySelectorAll("input, select").forEach(function(el){
      el.addEventListener("change", recalcTotalDailyHours);
      el.addEventListener("input", recalcTotalDailyHours);
    });

    container.querySelectorAll(".hl-remove-visit-btn").forEach(function(btn){
      btn.addEventListener("click", function(){
        var currentVisits = getVisitsFromEditor();
        var index = parseInt(btn.dataset.index, 10);
        if(currentVisits.length <= 1){
          alert("Debes mantener al menos 1 visita o marcar 'Libre / Descanso'.");
          return;
        }
        currentVisits.splice(index, 1);
        renderVisitsEditor(currentVisits);
      });
    });

    var addBtn = document.getElementById("hlAddVisitBtn");
    var limitHint = document.getElementById("hlVisitLimitHint");
    if(addBtn){
      addBtn.disabled = false;
      addBtn.style.opacity = "1";
      if(limitHint) limitHint.textContent = "(Agrega las visitas necesarias por día)";
    }
  }

  function getVisitsFromEditor(){
    var container = document.getElementById("hlVisitsContainer");
    if(!container) return [];
    var cards = container.querySelectorAll(".hl-visit-card");
    var visits = [];
    cards.forEach(function(card){
      var pdv = card.querySelector(".hl-visit-pdv-select").value.trim();
      var start = card.querySelector(".hl-visit-start-inp").value;
      var end = card.querySelector(".hl-visit-end-inp").value;
      visits.push({ pdv: pdv, start: start, end: end });
    });
    return visits;
  }

  function recalcTotalDailyHours(){
    var visits = getVisitsFromEditor();
    var totalHrs = 0;
    visits.forEach(function(v){
      totalHrs += calcVisitHours(v.start, v.end);
    });
    var badge = document.getElementById("hlTotalDailyBadge");
    if(badge){
      badge.textContent = "Total del día: " + (Number.isInteger(totalHrs) ? totalHrs : totalHrs.toFixed(1)) + " hrs";
    }
    return totalHrs;
  }

  function moveEditorHome(){
    var editor = document.getElementById("hlEditor");
    if(!editor) return;
    var editorRow = editor.closest("tr.horario-editor-row") || document.querySelector("#hlScheduleHolder tr.horario-editor-row");
    var homeContainer = document.querySelector("#page-horarioslideres .horario-wrap") || document.querySelector("#page-horarioslideres .wrap") || document.getElementById("page-horarioslideres");
    if(homeContainer && editor.parentNode !== homeContainer){
      homeContainer.appendChild(editor);
    }
    if(editorRow){
      editorRow.remove();
    }
    document.querySelectorAll("#hlScheduleHolder tr.horario-editor-row").forEach(function(r){ r.remove(); });
    editor.hidden = true;
  }

  function openEditor(email, key, sourceButton){
    var person = state.roster.find(function(p){ return clean(p.email).toLowerCase() === clean(email).toLowerCase(); });
    if(!person) return;

    state.selected = { email: email, date: key, name: person.full_name || email, cargo: person.cargo || "Líder" };
    var shift = findShift(email, key);

    moveEditorHome();
    var editor = document.getElementById("hlEditor");
    if(!editor) return;
    editor.hidden = false;

    var row = document.createElement("tr"), cell = document.createElement("td");
    row.className = "horario-editor-row";
    cell.colSpan = 9;
    cell.appendChild(editor);
    row.appendChild(cell);

    if(sourceButton && sourceButton.closest("tr")){
      sourceButton.closest("tr").insertAdjacentElement("afterend", row);
    }

    document.getElementById("hlEditorLabel").textContent = (person.full_name || email) + " · " + key + " (" + (person.cargo || "Líder") + ")";

    var visits = parseVisitsFromShift(shift);
    renderVisitsEditor(visits);

    if(sourceButton) sourceButton.scrollIntoView({behavior:"smooth", block:"nearest"});
  }

  function closeEditor(){
    state.selected = null;
    moveEditorHome();
    renderSchedule();
  }

  function copyEditorShift(){
    if(!state.selected){ alert("Selecciona un día en la tabla para copiar."); return; }
    var visits = getVisitsFromEditor();
    if(!visits.length){ alert("Configura al menos una visita para copiar."); return; }

    state.copiedShift = { visits: visits };

    document.getElementById("hlPasteShift").disabled = false;
    document.getElementById("hlPasteShift").title = "Pegar el día y tiendas copiadas.";
    alert("Día y tiendas copiadas. Puedes pegarlo en otros días.");
  }

  async function pasteCopiedShift(){
    if(!state.copiedShift){ alert("Primero copia un día configurado."); return; }
    await saveEditor(false, state.copiedShift);
  }

  async function saveEditor(off, copied){
    if(!state.selected) return;

    var visits = [];
    if(copied && copied.visits){
      visits = copied.visits;
    }else if(!off){
      visits = getVisitsFromEditor();
    }

    if(!off){
      if(!visits.length){
        alert("Agrega al menos una tienda o indica 'Libre / Descanso'.");
        return;
      }
      for(var i = 0; i < visits.length; i++){
        var v = visits[i];
        if(!v.pdv){
          alert("Por favor selecciona la tienda en la visita N°" + (i+1) + ".");
          return;
        }
        if(!v.start || !v.end || v.end <= v.start){
          alert("Verifica que la hora de inicio y fin de la visita N°" + (i+1) + " sean correctas.");
          return;
        }
      }
    }

    var start = off || !visits.length ? null : visits[0].start;
    var end = off || !visits.length ? null : visits[visits.length - 1].end;
    var pdvArray = off ? [] : visits.map(function(v){
      return v.pdv + " (" + v.start + "-" + v.end + ")";
    });

    var payload = {
      leader_email: state.selected.email,
      leader_name: state.selected.name,
      cargo: state.selected.cargo,
      shift_date: state.selected.date,
      is_day_off: !!off,
      start_time: start,
      end_time: end,
      break_start: null,
      break_end: null,
      pdvs: pdvArray,
      updated_by: state.profile.email,
      updated_at: new Date().toISOString()
    };

    try{
      if(window.supabaseClient){
        var res = await window.supabaseClient.from("horario_lideres").upsert(payload, {onConflict: "leader_email,shift_date"});
        if(res && res.error) console.warn("Supabase upsert warning:", res.error);
      }
    }catch(e){
      console.warn("Excepción guardando turno en Supabase:", e);
    }

    var idx = state.shifts.findIndex(function(s){ return clean(s.leader_email).toLowerCase() === clean(payload.leader_email).toLowerCase() && s.shift_date === payload.shift_date; });
    if(idx !== -1){
      state.shifts[idx] = payload;
    }else{
      state.shifts.push(payload);
    }

    closeEditor();
  }

  async function refresh(){
    var currentWeek = dateKey(state.weekStart) === dateKey(mondayOf(new Date()));
    document.getElementById("hlWeekLabel").textContent = (currentWeek ? "Semana actual · " : "Semana del ") + formatWeek();
    try{
      setHint("Cargando horarios de líderes…");
      await loadShifts();
      renderSchedule();
      setHint("Selecciona un día en la tabla para programar las visitas y horas por tienda del líder.");
    }catch(error){
      console.error("Horarios Líderes:", error);
      document.getElementById("hlScheduleHolder").innerHTML = '<div class="horario-empty">No se pudieron cargar los horarios de líderes.</div>';
      setHint("Error de conexión al cargar horarios.", true);
    }
  }

  async function init(){
    try{
      await loadOfficialPdvs();
      await loadProfile();
      await loadRoster();
      state.loaded = true;
      await refresh();
    }catch(error){
      console.error("Inicialización Horarios Líderes:", error);
      document.getElementById("hlScheduleHolder").innerHTML = '<div class="horario-empty">Error al iniciar Horarios Líderes.</div>';
      setHint("No se pudo cargar la vista.", true);
    }
  }

  window.loadHorariosLideres = init;

  document.addEventListener("DOMContentLoaded", function(){
    var prevBtn = document.getElementById("hlPrevWeek");
    if(prevBtn) prevBtn.addEventListener("click", function(){ state.weekStart = addDays(state.weekStart, -7); refresh(); });

    var nextBtn = document.getElementById("hlNextWeek");
    if(nextBtn) nextBtn.addEventListener("click", function(){ state.weekStart = addDays(state.weekStart, 7); refresh(); });

    var weekLabel = document.getElementById("hlWeekLabel");
    if(weekLabel) weekLabel.addEventListener("click", function(){ state.weekStart = mondayOf(new Date()); refresh(); });

    var expSched = document.getElementById("hlExportSchedule");
    if(expSched) expSched.addEventListener("click", function(){ exportTableToExcel("hlScheduleHolder", "horario-lideres-" + dateKey(state.weekStart)); });

    var capSched = document.getElementById("hlCaptureSchedule");
    if(capSched) capSched.addEventListener("click", function(){ copyTableCapture("hlScheduleHolder", "horario-lideres-" + dateKey(state.weekStart), this); });

    var cancelEdit = document.getElementById("hlCancelEdit");
    if(cancelEdit) cancelEdit.addEventListener("click", closeEditor);

    var copyShift = document.getElementById("hlCopyShift");
    if(copyShift) copyShift.addEventListener("click", copyEditorShift);

    var pasteShift = document.getElementById("hlPasteShift");
    if(pasteShift) pasteShift.addEventListener("click", function(){ pasteCopiedShift().catch(function(e){ alert("No se pudo pegar: " + e.message); }); });

    var saveEdit = document.getElementById("hlSaveEdit");
    if(saveEdit) saveEdit.addEventListener("click", function(){ saveEditor(false).catch(function(e){ alert("No se pudo guardar: " + e.message); }); });

    var addVisitBtn = document.getElementById("hlAddVisitBtn");
    if(addVisitBtn){
      addVisitBtn.addEventListener("click", function(){
        var visits = getVisitsFromEditor();
        var defaultStart = "09:00", defaultEnd = "18:00";
        if(visits.length > 0){
          var last = visits[visits.length - 1];
          if(last && last.end) defaultStart = last.end;
        }
        visits.push({ pdv: "", start: defaultStart, end: defaultEnd });
        renderVisitsEditor(visits);
      });
    }

    document.querySelectorAll(".hl-preset").forEach(function(button){
      button.addEventListener("click", function(){
        if(button.dataset.off === "true"){
          saveEditor(true).catch(function(e){ alert("No se pudo guardar: " + e.message); });
          return;
        }
      });
    });
  });
})();
