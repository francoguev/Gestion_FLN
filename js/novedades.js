(function(){
  var NOVEDADES_TABLE = "novedades";
  var NOVEDADES_BUCKET = "novedades";
  var DISMISSED_KEY = "fortalecernos_novedades_dismissed";
  var isOperaciones = false;
  var realtimeChannel = null;
  var novedadesCache = [];   // últimos datos cargados, para poder editar sin volver a pedirlos
  var editingId = null;      // id de la novedad que se está editando (null = modo "publicar nueva")
  var editingItemImageUrl = "";

  function getDismissedSet(){
    try{
      var raw = localStorage.getItem(DISMISSED_KEY);
      return raw ? JSON.parse(raw) : [];
    }catch(e){ return []; }
  }
  function addDismissed(id){
    try{
      var arr = getDismissedSet();
      if(arr.indexOf(id) === -1){ arr.push(id); localStorage.setItem(DISMISSED_KEY, JSON.stringify(arr)); }
    }catch(e){}
  }

  function escapeHtmlN(s){
    return (s || "").toString()
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }

  function renderMarkdown(md){
    // Se escapa primero y solo después se transforma un subconjunto seguro de
    // Markdown. Por ello el HTML guardado en Supabase nunca se interpreta.
    var lines = (md || "").toString().replace(/\r\n?/g, "\n").split("\n");
    var html = [];
    var listItems = [];

    function safeUrl(value){
      try{
        var url = new URL(value, window.location.origin);
        return (url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:")
          ? url.href : null;
      }catch(e){ return null; }
    }

    function inline(value){
      var text = escapeHtmlN(value);
      text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
      text = text.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, function(_, label, url){
        var href = safeUrl(url);
        return href
          ? '<a href="' + escapeHtmlN(href) + '" target="_blank" rel="noopener noreferrer">' + label + "</a>"
          : label;
      });
      text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
      return text;
    }

    function flushList(){
      if(!listItems.length) return;
      html.push("<ul>" + listItems.map(function(item){ return "<li>" + inline(item) + "</li>"; }).join("") + "</ul>");
      listItems = [];
    }

    lines.forEach(function(line){
      var heading = line.match(/^(#{1,3})\s+(.+)$/);
      var bullet = line.match(/^\s*[-*]\s+(.+)$/);
      if(bullet){ listItems.push(bullet[1]); return; }
      flushList();
      if(heading){
        var level = heading[1].length;
        html.push("<h" + level + ">" + inline(heading[2]) + "</h" + level + ">");
      }else if(line.trim()){
        html.push("<p>" + inline(line) + "</p>");
      }
    });
    flushList();
    return html.join("") || "<p></p>";
  }

  function formatFecha(iso){
    try{
      var d = new Date(iso);
      return d.toLocaleDateString("es-PE",{day:"2-digit",month:"short",year:"numeric"}) + " · " +
        d.toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit"});
    }catch(e){ return ""; }
  }

  function novedadCardHtml(item){
    var imgHtml = item.image_url
      ? '<div class="novedad-img"><img src="' + escapeHtmlN(item.image_url) + '" alt=""></div>'
      : "";
    var badge = item.is_birthday
      ? '<span class="novedad-important-badge novedad-birthday-badge">🎉 Estamos de fiesta</span>'
      : (item.important ? '<span class="novedad-important-badge">Importante</span>' : "");
    var titleHtml = item.title ? '<div class="novedad-title">' + escapeHtmlN(item.title) + '</div>' : "";
    var metaBits = [formatFecha(item.created_at)];
    if(item.created_by) metaBits.push(escapeHtmlN(item.created_by));
    var actions = isOperaciones
      ? '<div class="novedad-actions">' +
          '<button type="button" class="novedad-edit-btn" data-id="' + item.id + '">Editar</button>' +
          '<button type="button" class="novedad-delete-btn" data-id="' + item.id + '">Eliminar</button>' +
        '</div>'
      : "";
    return '<div class="novedad-card">' +
      imgHtml +
      '<div class="novedad-body">' +
        badge +
        titleHtml +
        '<div class="novedad-meta">' + metaBits.join(" · ") + '</div>' +
        '<div class="novedad-content">' + renderMarkdown(item.content_md) + '</div>' +
        actions +
      '</div>' +
    '</div>';
  }

  async function loadNovedades(){
    var list = document.getElementById("novedadesList");
    if(!list || !window.supabaseClient) return;
    list.innerHTML = '<p class="hint">Cargando novedades…</p>';
    try{
      var res = await window.supabaseClient.from(NOVEDADES_TABLE).select("*").order("created_at",{ascending:false});
      if(res.error){ list.innerHTML = '<p class="hint">No se pudieron cargar las novedades.</p>'; return; }
      var items = res.data || [];
      novedadesCache = items;
      if(!items.length){
        list.innerHTML = '<p class="hint">Todavía no hay novedades publicadas.</p>';
        return;
      }
      list.innerHTML = items.map(novedadCardHtml).join("");
      wireDeleteButtons();
      wireEditButtons();
    }catch(e){
      list.innerHTML = '<p class="hint">No se pudieron cargar las novedades.</p>';
    }
  }

  function wireDeleteButtons(){
    document.querySelectorAll(".novedad-delete-btn").forEach(function(btn){
      btn.addEventListener("click", async function(){
        if(!confirm("¿Eliminar esta novedad? Esta acción no se puede deshacer.")) return;
        var id = btn.getAttribute("data-id");
        btn.disabled = true;
        btn.textContent = "Eliminando…";
        try{
          await window.supabaseClient.from(NOVEDADES_TABLE).delete().eq("id", id);
          if(String(editingId) === String(id)) exitEditMode();
          loadNovedades();
        }catch(e){
          alert("No se pudo eliminar. Intenta de nuevo.");
          btn.disabled = false;
          btn.textContent = "Eliminar";
        }
      });
    });
  }

  function wireEditButtons(){
    document.querySelectorAll(".novedad-edit-btn").forEach(function(btn){
      btn.addEventListener("click", function(){
        var id = btn.getAttribute("data-id");
        var item = novedadesCache.find(function(n){ return String(n.id) === String(id); });
        if(item) enterEditMode(item);
      });
    });
  }

  function enterEditMode(item){
    editingId = item.id;
    editingItemImageUrl = item.image_url || "";
    document.getElementById("novedadTitulo").value = item.title || "";
    document.getElementById("novedadTexto").value = item.content_md || "";
    document.getElementById("novedadImportante").checked = !!item.important && !item.is_birthday;
    document.getElementById("novedadCumple").checked = !!item.is_birthday;
    document.getElementById("novedadImagen").value = "";
    var imgHint = document.getElementById("novedadCurrentImgHint");
    imgHint.textContent = item.image_url
      ? "Ya tiene una imagen. Elige un archivo solo si quieres reemplazarla."
      : "";
    document.getElementById("novedadFormTitle").textContent = "Editar novedad";
    document.getElementById("novedadSubmitBtn").textContent = "Guardar cambios";
    document.getElementById("novedadCancelEditBtn").style.display = "";
    document.getElementById("novedadFormMsg").textContent = "";
    var adminCard = document.getElementById("novedadesAdminCard");
    if(adminCard) adminCard.scrollIntoView({behavior:"smooth", block:"start"});
  }

  function exitEditMode(){
    editingId = null;
    editingItemImageUrl = "";
    var form = document.getElementById("novedadForm");
    if(form) form.reset();
    document.getElementById("novedadCurrentImgHint").textContent = "";
    document.getElementById("novedadFormTitle").textContent = "Publicar novedad";
    document.getElementById("novedadSubmitBtn").textContent = "Publicar";
    document.getElementById("novedadCancelEditBtn").style.display = "none";
  }

  function openNovedadLightbox(src){
    var overlay = document.getElementById("novedadLightboxOverlay");
    var img = document.getElementById("novedadLightboxImg");
    if(!overlay || !img) return;
    img.src = src;
    overlay.style.display = "flex";
  }

  function closeNovedadLightbox(){
    var overlay = document.getElementById("novedadLightboxOverlay");
    if(overlay) overlay.style.display = "none";
  }

  function showNovedadPopup(item){
    var overlay = document.getElementById("novedadPopupOverlay");
    if(!overlay) return;
    var imgWrap = document.getElementById("novedadPopupImg");
    var imgTag = document.getElementById("novedadPopupImgTag");
    if(item.image_url){
      imgTag.src = item.image_url;
      imgWrap.style.display = "";
    }else{
      imgWrap.style.display = "none";
    }
    var badgeEl = document.getElementById("novedadPopupBadge");
    if(badgeEl){
      badgeEl.textContent = item.is_birthday ? "🎉 Estamos de fiesta" : "Importante";
      badgeEl.classList.toggle("novedad-birthday-badge", !!item.is_birthday);
    }
    var titleEl = document.getElementById("novedadPopupTitle");
    if(titleEl){
      if(item.title && item.title !== "Novedad importante"){
        titleEl.textContent = item.title;
        titleEl.style.display = "";
      }else{
        titleEl.textContent = "";
        titleEl.style.display = "none";
      }
    }
    document.getElementById("novedadPopupContent").innerHTML = renderMarkdown(item.content_md);
    overlay.style.display = "flex";
    overlay.setAttribute("data-current-id", item.id);
  }

  function hideNovedadPopup(){
    var overlay = document.getElementById("novedadPopupOverlay");
    if(!overlay) return;
    var id = overlay.getAttribute("data-current-id");
    if(id) addDismissed(isNaN(Number(id)) ? id : Number(id));
    overlay.style.display = "none";
  }

  async function checkImportantPopupOnOpen(){
    if(!window.supabaseClient) return;
    try{
      var res = await window.supabaseClient.from(NOVEDADES_TABLE)
        .select("*").eq("important", true).order("created_at",{ascending:false}).limit(1);
      if(res.error || !res.data || !res.data.length) return;
      var item = res.data[0];
      var dismissed = getDismissedSet();
      if(dismissed.indexOf(item.id) === -1){
        showNovedadPopup(item);
      }
    }catch(e){}
  }

  function subscribeRealtime(){
    if(realtimeChannel || !window.supabaseClient) return;
    realtimeChannel = window.supabaseClient
      .channel("novedades-realtime")
      .on("postgres_changes", { event:"INSERT", schema:"public", table:NOVEDADES_TABLE }, function(payload){
        var row = payload.new;
        var activePage = document.getElementById("page-novedades");
        if(activePage && activePage.classList.contains("active")) loadNovedades();
        if(row && row.important) showNovedadPopup(row);
      })
      .on("postgres_changes", { event:"DELETE", schema:"public", table:NOVEDADES_TABLE }, function(){
        var activePage = document.getElementById("page-novedades");
        if(activePage && activePage.classList.contains("active")) loadNovedades();
      })
      .subscribe();
  }

  async function checkIsOperaciones(){
    var profile = window.currentUserProfile;
    var adminCard = document.getElementById("novedadesAdminCard");
    if(!profile || !profile.email || !window.supabaseClient){
      isOperaciones = false;
      if(adminCard) adminCard.style.display = "none";
      return;
    }
    try{
      var res = await window.supabaseClient.from("profiles").select("cargo").eq("email", profile.email).maybeSingle();
      var cargo = (res.data && res.data.cargo) || "";
      isOperaciones = cargo.trim().toLowerCase() === "operaciones";
    }catch(e){ isOperaciones = false; }
    if(adminCard) adminCard.style.display = isOperaciones ? "" : "none";
  }

  window.loadNovedadesPage = async function(){
    await checkIsOperaciones();
    await loadNovedades();
    subscribeRealtime();
  };

  // Se llama justo después de iniciar sesión, sin importar en qué página
  // aterrice el usuario: muestra el pop-up si hay algo importante pendiente.
  window.checkImportantNovedadPopup = checkImportantPopupOnOpen;

  document.addEventListener("DOMContentLoaded", function(){
    var closeBtn = document.getElementById("novedadPopupClose");
    if(closeBtn) closeBtn.addEventListener("click", hideNovedadPopup);
    var overlay = document.getElementById("novedadPopupOverlay");
    if(overlay){
      overlay.addEventListener("click", function(e){
        if(e.target === overlay) hideNovedadPopup();
      });
    }

    var list = document.getElementById("novedadesList");
    if(list){
      list.addEventListener("click", function(e){
        var imgEl = e.target.closest ? e.target.closest(".novedad-img img") : null;
        if(imgEl) openNovedadLightbox(imgEl.src);
      });
    }
    var lightboxOverlay = document.getElementById("novedadLightboxOverlay");
    var lightboxClose = document.getElementById("novedadLightboxClose");
    if(lightboxOverlay){
      lightboxOverlay.addEventListener("click", function(e){
        if(e.target === lightboxOverlay) closeNovedadLightbox();
      });
    }
    if(lightboxClose) lightboxClose.addEventListener("click", closeNovedadLightbox);

    var importanteCheck = document.getElementById("novedadImportante");
    var cumpleCheck = document.getElementById("novedadCumple");
    if(importanteCheck && cumpleCheck){
      importanteCheck.addEventListener("change", function(){
        if(importanteCheck.checked) cumpleCheck.checked = false;
      });
      cumpleCheck.addEventListener("change", function(){
        if(cumpleCheck.checked) importanteCheck.checked = false;
      });
    }

    var form = document.getElementById("novedadForm");
    if(form){
      form.addEventListener("submit", async function(e){
        e.preventDefault();
        var msg = document.getElementById("novedadFormMsg");
        var submitBtn = document.getElementById("novedadSubmitBtn");
        var titulo = document.getElementById("novedadTitulo").value.trim();
        var texto = document.getElementById("novedadTexto").value.trim();
        var importanteChecked = document.getElementById("novedadImportante").checked;
        var cumpleChecked = document.getElementById("novedadCumple").checked;
        var importante = importanteChecked || cumpleChecked;
        var fileInput = document.getElementById("novedadImagen");
        var file = fileInput.files && fileInput.files[0];
        var isEditing = editingId !== null;
        var existingImageUrl = isEditing ? editingItemImageUrl : "";

        if(!texto && !file && !existingImageUrl){
          msg.textContent = "Escribe un texto o agrega una imagen.";
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = isEditing ? "Guardando…" : "Publicando…";
        msg.textContent = "";
        try{
          var imageUrl = existingImageUrl;
          if(file){
            var path = Date.now() + "_" + file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
            var upRes = await window.supabaseClient.storage.from(NOVEDADES_BUCKET).upload(path, file);
            if(upRes.error) throw upRes.error;
            var pub = window.supabaseClient.storage.from(NOVEDADES_BUCKET).getPublicUrl(path);
            imageUrl = pub.data && pub.data.publicUrl ? pub.data.publicUrl : "";
          }
          var profile = window.currentUserProfile || {};
          var payload = {
            title: titulo || null,
            content_md: texto,
            image_url: imageUrl || null,
            important: importante,
            is_birthday: cumpleChecked
          };
          if(isEditing){
            var updRes = await window.supabaseClient.from(NOVEDADES_TABLE).update(payload).eq("id", editingId);
            if(updRes.error) throw updRes.error;
            msg.textContent = "¡Cambios guardados!";
            exitEditMode();
          }else{
            payload.created_by = profile.fullName || profile.email || "";
            var insertRes = await window.supabaseClient.from(NOVEDADES_TABLE).insert(payload);
            if(insertRes.error) throw insertRes.error;
            form.reset();
            msg.textContent = "¡Publicado!";
          }
          loadNovedades();
        }catch(err){
          console.error("Error al guardar novedad:", err);
          var detail = (err && (err.message || err.error_description || err.hint)) || "";
          msg.textContent = (isEditing ? "No se pudo guardar" : "No se pudo publicar") + (detail ? ": " + detail : ". Intenta de nuevo.");
        }
        submitBtn.disabled = false;
        submitBtn.textContent = editingId !== null ? "Guardar cambios" : "Publicar";
      });
    }

    var cancelEditBtn = document.getElementById("novedadCancelEditBtn");
    if(cancelEditBtn) cancelEditBtn.addEventListener("click", exitEditMode);
  });
})();
