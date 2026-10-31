/* =====================================================================
   May'Mode976 — application marketplace mode (PWA mobile & tablette)
   Annonces • Comptes • Messagerie acheteur/vendeur • Frais 1 % HT
   ===================================================================== */
const CFG = window.APP_CONFIG;
const sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

const COMMUNES = ["Acoua","Bandraboua","Bandrélé","Bouéni","Chiconi","Chirongui","Dembéni","Dzaoudzi","Kani-Kéli",
  "Koungou","Mamoudzou","M'Tsamboro","M'Tsangamouji","Ouangani","Pamandzi","Sada","Tsingoni"];
const CATEGORIES = {
  Femme: ["Robes","Hauts & T-shirts","Pantalons & Jeans","Jupes","Salouvas & tenues traditionnelles","Vestes & Manteaux","Chaussures","Lingerie","Sport","Autre"],
  Homme: ["T-shirts & Polos","Chemises","Pantalons & Jeans","Shorts","Kandzous & tenues traditionnelles","Vestes","Chaussures","Sport","Autre"],
  Enfant: ["Bébé (0-2 ans)","Fille","Garçon","Chaussures enfant","Uniformes & école","Autre"],
  Accessoires: ["Sacs","Bijoux","Montres","Lunettes","Ceintures","Chapeaux & foulards","Parfums","Autre"]
};
const ETATS = ["Neuf avec étiquette","Neuf","Très bon état","Bon état","Occasion"];
const MAX_PHOTOS = 5;

let session = null, moi = null, canalChat = null, canalGlobal = null;
const $app = document.getElementById("app");

/* ---------- Outils ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const euros = n => Number(n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const frais = prixHT => Math.round(Number(prixHT || 0) * CFG.TAUX_FRAIS * 100) / 100;
const dateCourte = d => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const heure = d => new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const options = (liste, sel = "", vide = "") =>
  (vide ? `<option value="">${esc(vide)}</option>` : "") + liste.map(v => `<option ${v === sel ? "selected" : ""}>${esc(v)}</option>`).join("");
function toast(msg) {
  const t = document.getElementById("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3000);
}
function exigerConnexion() {
  if (session) return true;
  sessionStorage.setItem("apresConnexion", location.hash);
  location.hash = "#/compte"; toast("Connectez-vous pour continuer"); return false;
}

/* ---------- Photos : compression avant envoi ---------- */
async function compresser(fichier, max = 1280) {
  const img = await createImageBitmap(fichier);
  const r = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return new Promise(ok => c.toBlob(ok, "image/jpeg", 0.82));
}
async function envoyerPhotos(fichiers) {
  const urls = [];
  for (const f of [...fichiers].slice(0, MAX_PHOTOS)) {
    const blob = await compresser(f);
    const chemin = `${session.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await sb.storage.from("mode-photos").upload(chemin, blob, { contentType: "image/jpeg" });
    if (error) throw error;
    urls.push(sb.storage.from("mode-photos").getPublicUrl(chemin).data.publicUrl);
  }
  return urls;
}

/* ---------- Routeur ---------- */
const routes = [
  [/^#?\/?$/, vueAccueil],
  [/^#\/annonce\/(\d+)$/, vueAnnonce],
  [/^#\/vendre$/, vueVendre],
  [/^#\/modifier\/(\d+)$/, vueVendre],
  [/^#\/messages$/, vueMessages],
  [/^#\/messages\/(\d+)$/, vueChat],
  [/^#\/compte$/, vueCompte],
];
async function router() {
  if (canalChat) { sb.removeChannel(canalChat); canalChat = null; }
  const h = location.hash || "#/";
  if (/access_token|error_description|type=recovery/.test(h)) return; // retour d'un lien e-mail : Supabase le traite
  const tab = h.startsWith("#/vendre") || h.startsWith("#/modifier") ? "vendre" : h.startsWith("#/messages") ? "messages" : h.startsWith("#/compte") ? "compte" : "accueil";
  document.querySelectorAll(".tabbar a").forEach(a => a.classList.toggle("actif", a.dataset.tab === tab));
  for (const [re, vue] of routes) {
    const m = h.match(re);
    if (m) { $app.innerHTML = `<p class="chargement">Chargement…</p>`; window.scrollTo(0, 0);
      try { await vue(...m.slice(1)); } catch (e) { console.error(e); $app.innerHTML = `<p class="vide">Oups, une erreur est survenue.<br><small>${esc(e.message)}</small></p>`; }
      return; }
  }
  location.hash = "#/";
}

/* ---------- Accueil : liste et filtres ---------- */
const filtre = { categorie: "", sous: "", commune: "", q: "" };
async function vueAccueil() {
  $app.innerHTML = `
    <h1>Mode à Mayotte</h1>
    <div class="cats" id="cats">
      ${["", ...Object.keys(CATEGORIES)].map(c => `<button data-c="${c}" class="${filtre.categorie === c ? "on" : ""}">${c || "Tout"}</button>`).join("")}
    </div>
    <div class="filtres">
      <input id="f-q" type="search" placeholder="Rechercher (robe, sac, baskets…)" value="${esc(filtre.q)}">
      <select id="f-sous">${options(CATEGORIES[filtre.categorie] || [], filtre.sous, "Tous les articles")}</select>
      <select id="f-commune">${options(COMMUNES, filtre.commune, "Toutes les communes")}</select>
    </div>
    <div class="grille" id="liste"><p class="chargement">Chargement…</p></div>`;
  document.getElementById("cats").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    filtre.categorie = b.dataset.c; filtre.sous = ""; vueAccueil();
  };
  document.getElementById("f-sous").onchange = e => { filtre.sous = e.target.value; chargerListe(); };
  document.getElementById("f-commune").onchange = e => { filtre.commune = e.target.value; chargerListe(); };
  let t; document.getElementById("f-q").oninput = e => { clearTimeout(t); t = setTimeout(() => { filtre.q = e.target.value.trim(); chargerListe(); }, 350); };
  chargerListe();
}
async function chargerListe() {
  let req = sb.from("mode_annonces").select("id,titre,prix_ht,commune,photos,categorie,taille,etat")
    .eq("statut", "en_vente").order("created_at", { ascending: false }).limit(60);
  if (filtre.categorie) req = req.eq("categorie", filtre.categorie);
  if (filtre.sous) req = req.eq("sous_categorie", filtre.sous);
  if (filtre.commune) req = req.eq("commune", filtre.commune);
  if (filtre.q) req = req.ilike("titre", `%${filtre.q.replace(/[%_,()]/g, " ")}%`);
  const { data, error } = await req;
  const el = document.getElementById("liste"); if (!el) return;
  if (error) { el.innerHTML = `<p class="vide">Erreur : ${esc(error.message)}</p>`; return; }
  el.innerHTML = data.length ? data.map(carte).join("") : `<p class="vide" style="grid-column:1/-1">Aucun article pour le moment.<br>Soyez le premier à vendre !</p>`;
}
const carte = a => `
  <a class="carte" href="#/annonce/${a.id}">
    <div class="img" style="background-image:url('${esc(a.photos?.[0] || "")}')">${a.taille ? `<span class="tag">${esc(a.taille)}</span>` : ""}</div>
    <div class="corps"><div class="prix">${euros(a.prix_ht)}</div><div class="titre">${esc(a.titre)}</div><div class="lieu">${esc(a.commune)}</div></div>
  </a>`;

/* ---------- Fiche annonce ---------- */
async function vueAnnonce(id) {
  const { data: a, error } = await sb.from("mode_annonces").select("*, vendeur:mode_profils(id,nom,type_compte,commune)").eq("id", id).single();
  if (error || !a) { $app.innerHTML = `<p class="vide">Annonce introuvable.</p>`; return; }
  const estMoi = session && session.user.id === a.vendeur_id;
  $app.innerHTML = `
    <a class="retour" href="#/">← Retour</a>
    <div class="fiche">
      <div class="galerie">${(a.photos.length ? a.photos : [""]).map(u => `<img src="${esc(u)}" alt="" loading="lazy">`).join("")}</div>
      <div>
        <h1 style="margin-top:12px">${esc(a.titre)}</h1>
        <div class="prix-xl">${euros(a.prix_ht)}</div>
        ${a.statut === "vendu" ? `<p><b>Vendu</b></p>` : ""}
        <div class="meta">
          <span>${esc(a.categorie)}</span>${a.sous_categorie ? `<span>${esc(a.sous_categorie)}</span>` : ""}
          ${a.taille ? `<span>Taille ${esc(a.taille)}</span>` : ""}<span>${esc(a.etat)}</span><span>📍 ${esc(a.commune)}</span>
        </div>
        <p style="white-space:pre-wrap">${esc(a.description || "")}</p>
        <div class="boite"><div class="ligne"><div><b>${esc(a.vendeur?.nom)}</b><div class="petit">${a.vendeur?.type_compte === "professionnel" ? "Boutique professionnelle" : "Particulier"} · ${esc(a.vendeur?.commune || "")}</div></div></div></div>
        <p class="petit">Publié le ${dateCourte(a.created_at)} · Paiement et remise à convenir directement avec le vendeur.</p>
        ${estMoi
          ? `<a class="btn sec" href="#/modifier/${a.id}">Modifier mon annonce</a>`
          : a.statut === "en_vente" ? `<button class="btn" id="contacter">✉ Contacter le vendeur</button>` : ""}
      </div>
    </div>`;
  const b = document.getElementById("contacter");
  if (b) b.onclick = () => ouvrirConversation(a);
}
async function ouvrirConversation(a) {
  if (!exigerConnexion()) return;
  const moiId = session.user.id;
  let { data: c } = await sb.from("mode_conversations").select("id").eq("annonce_id", a.id).eq("acheteur_id", moiId).maybeSingle();
  if (!c) {
    const r = await sb.from("mode_conversations").insert({ annonce_id: a.id, acheteur_id: moiId, vendeur_id: a.vendeur_id }).select("id").single();
    if (r.error) { toast("Impossible d'ouvrir la conversation"); return; }
    c = r.data;
  }
  location.hash = `#/messages/${c.id}`;
}

/* ---------- Vendre / modifier ---------- */
async function vueVendre(idModif) {
  if (!exigerConnexion()) return;
  let a = { categorie: "Femme", etat: "Très bon état", commune: moi?.commune || "", photos: [] };
  if (idModif) {
    const { data } = await sb.from("mode_annonces").select("*").eq("id", idModif).single();
    if (!data || data.vendeur_id !== session.user.id) { location.hash = "#/compte"; return; }
    a = data;
  }
  $app.innerHTML = `
    <h1>${idModif ? "Modifier l'annonce" : "Vendre un article"}</h1>
    <form id="form-annonce" class="boite">
      <label>Photos (jusqu'à ${MAX_PHOTOS})</label>
      <input type="file" id="photos" accept="image/*" multiple>
      <div class="photos-prev" id="prev">${a.photos.map(u => `<img src="${esc(u)}">`).join("")}</div>
      <label>Titre</label><input name="titre" required maxlength="80" value="${esc(a.titre || "")}" placeholder="Ex : Robe longue fleurie">
      <label>Catégorie</label><select name="categorie" id="sel-cat">${options(Object.keys(CATEGORIES), a.categorie)}</select>
      <label>Type d'article</label><select name="sous_categorie" id="sel-sous">${options(CATEGORIES[a.categorie], a.sous_categorie, "Choisir…")}</select>
      <label>Taille (facultatif)</label><input name="taille" value="${esc(a.taille || "")}" placeholder="Ex : M, 38, 6 ans, taille unique">
      <label>État</label><select name="etat">${options(ETATS, a.etat)}</select>
      <label>Prix (€)</label><input name="prix_ht" type="number" inputmode="decimal" min="0" step="0.01" required value="${a.prix_ht ?? ""}">
      <p class="petit">À Mayotte la TVA n'est pas applicable : le prix affiché est le prix HT. Frais de service de 1 % dus uniquement si l'article est vendu : <b id="apercu-frais">${euros(frais(a.prix_ht))}</b>.</p>
      <label>Commune</label><select name="commune" required>${options(COMMUNES, a.commune, "Choisir…")}</select>
      <label>Description</label><textarea name="description" maxlength="2000" placeholder="Matière, couleur, défauts éventuels…">${esc(a.description || "")}</textarea>
      <button class="btn" id="publier">${idModif ? "Enregistrer" : "Publier l'annonce"}</button>
      ${idModif ? `<button type="button" class="btn sec" id="supprimer">Supprimer l'annonce</button>` : ""}
    </form>`;
  const f = document.getElementById("form-annonce");
  document.getElementById("sel-cat").onchange = e => { document.getElementById("sel-sous").innerHTML = options(CATEGORIES[e.target.value], "", "Choisir…"); };
  f.prix_ht.oninput = () => (document.getElementById("apercu-frais").textContent = euros(frais(f.prix_ht.value)));
  document.getElementById("photos").onchange = e => {
    const fs = [...e.target.files].slice(0, MAX_PHOTOS);
    if (e.target.files.length > MAX_PHOTOS) toast(`${MAX_PHOTOS} photos maximum`);
    document.getElementById("prev").innerHTML = fs.map(x => `<img src="${URL.createObjectURL(x)}">`).join("");
  };
  const sup = document.getElementById("supprimer");
  if (sup) sup.onclick = async () => {
    if (!confirm("Supprimer définitivement cette annonce ?")) return;
    await sb.from("mode_annonces").delete().eq("id", idModif); toast("Annonce supprimée"); location.hash = "#/compte";
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = document.getElementById("publier"); btn.disabled = true; btn.textContent = "Envoi en cours…";
    try {
      const fd = Object.fromEntries(new FormData(f));
      const fichiers = document.getElementById("photos").files;
      let photos = a.photos;
      if (fichiers.length) photos = await envoyerPhotos(fichiers);
      if (!idModif && !photos.length) throw new Error("Ajoutez au moins une photo");
      const ligne = { titre: fd.titre.trim(), categorie: fd.categorie, sous_categorie: fd.sous_categorie || null, taille: fd.taille.trim() || null,
        etat: fd.etat, prix_ht: Number(fd.prix_ht), commune: fd.commune, description: fd.description.trim(), photos };
      const r = idModif
        ? await sb.from("mode_annonces").update(ligne).eq("id", idModif).select("id").single()
        : await sb.from("mode_annonces").insert({ ...ligne, vendeur_id: session.user.id }).select("id").single();
      if (r.error) throw r.error;
      toast(idModif ? "Annonce mise à jour" : "Annonce publiée !"); location.hash = `#/annonce/${r.data.id}`;
    } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = idModif ? "Enregistrer" : "Publier l'annonce"; }
  };
}

/* ---------- Messagerie ---------- */
async function vueMessages() {
  if (!exigerConnexion()) return;
  const { data, error } = await sb.from("mode_conversations")
    .select("id, acheteur_id, vendeur_id, dernier_message_at, annonce:mode_annonces(titre,photos,prix_ht), acheteur:mode_profils!mode_conversations_acheteur_id_fkey(nom), vendeur:mode_profils!mode_conversations_vendeur_id_fkey(nom)")
    .order("dernier_message_at", { ascending: false });
  if (error) throw error;
  const { data: nonLus } = await sb.from("mode_messages").select("conversation_id").eq("lu", false).neq("auteur_id", session.user.id);
  const setNL = new Set((nonLus || []).map(m => m.conversation_id));
  $app.innerHTML = `<h1>Messages</h1>` + (data.length ? data.map(c => {
    const autre = c.acheteur_id === session.user.id ? c.vendeur?.nom : c.acheteur?.nom;
    return `<a class="conv" href="#/messages/${c.id}">
      <div class="vign" style="background-image:url('${esc(c.annonce?.photos?.[0] || "")}')"></div>
      <div class="txt"><div><b>${esc(autre)}</b></div><div class="petit">${esc(c.annonce?.titre)} · ${euros(c.annonce?.prix_ht)}</div></div>
      <div class="petit">${dateCourte(c.dernier_message_at)}</div>${setNL.has(c.id) ? `<span class="pt"></span>` : ""}</a>`;
  }).join("") : `<p class="vide">Aucune conversation.<br>Contactez un vendeur depuis une annonce.</p>`);
}
async function vueChat(id) {
  if (!exigerConnexion()) return;
  const moiId = session.user.id;
  const { data: c, error } = await sb.from("mode_conversations")
    .select("*, annonce:mode_annonces(id,titre,photos,prix_ht,statut), acheteur:mode_profils!mode_conversations_acheteur_id_fkey(nom), vendeur:mode_profils!mode_conversations_vendeur_id_fkey(nom)")
    .eq("id", id).single();
  if (error || !c) { $app.innerHTML = `<p class="vide">Conversation introuvable.</p>`; return; }
  const autre = c.acheteur_id === moiId ? c.vendeur?.nom : c.acheteur?.nom;
  $app.innerHTML = `
    <div class="chat">
      <div class="chat-entete">
        <a class="retour" href="#/messages" style="margin:0">←</a>
        <a href="#/annonce/${c.annonce.id}" class="conv" style="margin:0;padding:6px;flex:1;border:0">
          <div class="vign" style="width:40px;height:40px;background-image:url('${esc(c.annonce.photos?.[0] || "")}')"></div>
          <div class="txt"><div><b>${esc(autre)}</b></div><div class="petit">${esc(c.annonce.titre)} · ${euros(c.annonce.prix_ht)}</div></div>
        </a>
      </div>
      <div class="fil" id="fil"></div>
      <form class="saisie" id="f-msg"><textarea id="txt" placeholder="Votre message…" rows="1" maxlength="2000"></textarea><button>Envoyer</button></form>
    </div>`;
  const fil = document.getElementById("fil");
  const ajouter = m => {
    if (document.getElementById("m" + m.id)) return;
    fil.insertAdjacentHTML("beforeend", `<div id="m${m.id}" class="bulle ${m.auteur_id === moiId ? "moi" : "lui"}">${esc(m.contenu)}<small>${heure(m.created_at)}</small></div>`);
    fil.scrollTop = fil.scrollHeight;
  };
  const { data: msgs } = await sb.from("mode_messages").select("*").eq("conversation_id", id).order("created_at");
  (msgs || []).forEach(ajouter);
  if (!msgs?.length) fil.innerHTML = `<p class="petit" style="text-align:center">Dites bonjour 👋 Pour votre sécurité, privilégiez une remise en main propre dans un lieu public.</p>`;
  marquerLus(id);

  canalChat = sb.channel("conv-" + id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "mode_messages", filter: `conversation_id=eq.${id}` },
      p => { ajouter(p.new); if (p.new.auteur_id !== moiId) marquerLus(id); })
    .subscribe();

  const f = document.getElementById("f-msg"), txt = document.getElementById("txt");
  txt.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && window.innerWidth > 700) { e.preventDefault(); f.requestSubmit(); } };
  f.onsubmit = async e => {
    e.preventDefault();
    const contenu = txt.value.trim(); if (!contenu) return;
    txt.value = "";
    const { data, error } = await sb.from("mode_messages").insert({ conversation_id: Number(id), auteur_id: moiId, contenu }).select().single();
    if (error) { toast("Message non envoyé"); txt.value = contenu; return; }
    ajouter(data);
  };
}
async function marquerLus(convId) {
  await sb.from("mode_messages").update({ lu: true }).eq("conversation_id", convId).neq("auteur_id", session.user.id).eq("lu", false);
  majBadge();
}
async function majBadge() {
  const b = document.getElementById("badge-msg");
  if (!session) { b.hidden = true; return; }
  const { count } = await sb.from("mode_messages").select("id", { count: "exact", head: true }).eq("lu", false).neq("auteur_id", session.user.id);
  b.textContent = count; b.hidden = !count;
}
function ecouterNouveauxMessages() {
  if (canalGlobal) sb.removeChannel(canalGlobal);
  if (!session) return;
  canalGlobal = sb.channel("boite")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "mode_messages" }, p => {
      if (p.new.auteur_id === session.user.id) return;
      majBadge();
      if (!location.hash.startsWith("#/messages/")) toast("Nouveau message reçu");
      if (location.hash === "#/messages") vueMessages();
    }).subscribe();
}

/* ---------- Compte : connexion, profil, mes annonces, frais ---------- */
async function vueCompte() {
  if (!session) return vueConnexion();
  const { data: annonces } = await sb.from("mode_annonces").select("*").eq("vendeur_id", session.user.id).order("created_at", { ascending: false });
  const enVente = annonces.filter(a => a.statut === "en_vente"), vendus = annonces.filter(a => a.statut === "vendu");
  const totalFrais = vendus.reduce((s, a) => s + Number(a.frais_service || 0), 0);
  const totalVentes = vendus.reduce((s, a) => s + Number(a.prix_vente_ht || 0), 0);
  $app.innerHTML = `
    <h1>Bonjour ${esc(moi?.nom || "")}</h1>
    <div class="boite frais">
      <div class="ligne"><span>Ventes conclues</span><b>${vendus.length} · ${euros(totalVentes)} HT</b></div>
      <div class="ligne" style="margin-top:6px"><span>Frais de service (1 %)</span><b>${euros(totalFrais)}</b></div>
      <p class="petit" style="color:#d8cfee;margin-bottom:0">Les frais de service sont calculés sur le prix de vente HT de chaque article vendu.</p>
    </div>
    <div class="onglets"><button class="on" data-o="v">En vente (${enVente.length})</button><button data-o="s">Vendus (${vendus.length})</button><button data-o="p">Profil</button></div>
    <div id="onglet"></div>`;
  const rendre = o => {
    document.querySelectorAll(".onglets button").forEach(b => b.classList.toggle("on", b.dataset.o === o));
    const el = document.getElementById("onglet");
    if (o === "v") el.innerHTML = enVente.length ? enVente.map(a => `
      <div class="boite"><div class="ligne"><a href="#/annonce/${a.id}"><b>${esc(a.titre)}</b></a><b>${euros(a.prix_ht)}</b></div>
      <div class="ligne"><a class="btn sec" href="#/modifier/${a.id}" style="width:48%">Modifier</a><button class="btn ok" data-vendu="${a.id}" data-prix="${a.prix_ht}" style="width:48%">Marquer comme vendu</button></div></div>`).join("")
      : `<p class="vide">Aucun article en vente.<br><a href="#/vendre">Publier une annonce</a></p>`;
    if (o === "s") el.innerHTML = vendus.length ? vendus.map(a => `
      <div class="boite"><div class="ligne"><b>${esc(a.titre)}</b><span>${euros(a.prix_vente_ht)} HT</span></div>
      <div class="ligne petit"><span>Vendu le ${dateCourte(a.vendu_le)}</span><span>Frais : ${euros(a.frais_service)}</span></div></div>`).join("")
      : `<p class="vide">Aucune vente pour le moment.</p>`;
    if (o === "p") el.innerHTML = `
      <form id="f-profil" class="boite">
        <label>Nom affiché</label><input name="nom" required value="${esc(moi?.nom || "")}">
        <label>Commune</label><select name="commune">${options(COMMUNES, moi?.commune, "Choisir…")}</select>
        <label>Type de compte</label><select name="type_compte">
          <option value="particulier" ${moi?.type_compte !== "professionnel" ? "selected" : ""}>Particulier</option>
          <option value="professionnel" ${moi?.type_compte === "professionnel" ? "selected" : ""}>Professionnel (boutique)</option></select>
        <button class="btn">Enregistrer</button>
        <button type="button" class="btn sec" id="deco">Se déconnecter</button>
      </form>
      <p class="petit" style="text-align:center">Contact : ${esc(CFG.EMAIL_CONTACT)}</p>`;
    el.querySelectorAll("[data-vendu]").forEach(b => (b.onclick = () => marquerVendu(b.dataset.vendu, b.dataset.prix)));
    const fp = document.getElementById("f-profil");
    if (fp) {
      fp.onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(fp));
        const { error } = await sb.from("mode_profils").update(d).eq("id", session.user.id);
        if (error) return toast(error.message); moi = { ...moi, ...d }; toast("Profil enregistré"); };
      document.getElementById("deco").onclick = async () => { await sb.auth.signOut(); location.hash = "#/"; };
    }
  };
  document.querySelector(".onglets").onclick = e => { const b = e.target.closest("button"); if (b) rendre(b.dataset.o); };
  rendre("v");
}
async function marquerVendu(id, prixAffiche) {
  const saisie = prompt("Prix de vente final HT (€) :", prixAffiche);
  if (saisie === null) return;
  const prix = Number(String(saisie).replace(",", "."));
  if (!(prix >= 0)) return toast("Prix invalide");
  if (!confirm(`Confirmer la vente à ${euros(prix)} HT ?\nFrais de service (1 %) : ${euros(frais(prix))}`)) return;
  const { error } = await sb.from("mode_annonces").update({ statut: "vendu", prix_vente_ht: prix, vendu_le: new Date().toISOString() }).eq("id", id);
  if (error) return toast(error.message);
  toast("Vente enregistrée"); vueCompte();
}
function vueConnexion(mode = "connexion") {
  const inscr = mode === "inscription";
  $app.innerHTML = `
    <h1>${inscr ? "Créer un compte" : "Connexion"}</h1>
    <form id="f-auth" class="boite">
      ${inscr ? `<label>Nom ou nom de boutique</label><input name="nom" required>
        <label>Type de compte</label><select name="type_compte"><option value="particulier">Particulier</option><option value="professionnel">Professionnel (boutique)</option></select>
        <label>Commune</label><select name="commune" required>${options(COMMUNES, "", "Choisir…")}</select>` : ""}
      <label>E-mail</label><input name="email" type="email" autocomplete="email" required>
      <label>Mot de passe</label><input name="mdp" type="password" minlength="8" autocomplete="${inscr ? "new-password" : "current-password"}" required>
      ${inscr ? `<p class="petit">En créant un compte, vous acceptez de verser 1 % du prix de vente HT de chaque article vendu via l'application (frais de service).</p>` : ""}
      <button class="btn">${inscr ? "Créer mon compte" : "Se connecter"}</button>
      <button type="button" class="btn sec" id="bascule">${inscr ? "J'ai déjà un compte" : "Créer un compte"}</button>
      ${inscr ? "" : `<p style="text-align:center"><a href="#" id="oubli" class="petit">Mot de passe oublié ?</a></p>`}
    </form>`;
  document.getElementById("bascule").onclick = () => vueConnexion(inscr ? "connexion" : "inscription");
  const oubli = document.getElementById("oubli");
  if (oubli) oubli.onclick = async e => { e.preventDefault();
    const email = document.querySelector("[name=email]").value; if (!email) return toast("Saisissez votre e-mail");
    await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); toast("E-mail de réinitialisation envoyé"); };
  const f = document.getElementById("f-auth");
  f.onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(f));
    if (inscr) {
      const { data, error } = await sb.auth.signUp({ email: d.email, password: d.mdp,
        options: { emailRedirectTo: location.origin + location.pathname, data: { app: "maymode976", nom: d.nom, type_compte: d.type_compte, commune: d.commune } } });
      if (error) return toast(error.message);
      if (!data.session) { $app.innerHTML = `<div class="boite"><h2>Vérifiez vos e-mails ✉</h2><p>Cliquez sur le lien reçu à <b>${esc(d.email)}</b> pour activer votre compte.</p></div>`; return; }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email: d.email, password: d.mdp });
      if (error) return toast("E-mail ou mot de passe incorrect");
    }
  };
}

/* ---------- Session ---------- */
async function chargerProfil() {
  if (!session) { moi = null; return; }
  let { data } = await sb.from("mode_profils").select("*").eq("id", session.user.id).maybeSingle();
  if (!data) { // compte créé ailleurs (ex. autre site) : on crée le profil mode
    const meta = session.user.user_metadata || {};
    const r = await sb.from("mode_profils").insert({ id: session.user.id, nom: meta.nom || session.user.email.split("@")[0], commune: meta.commune || null }).select().single();
    data = r.data;
  }
  moi = data;
}
function majEntete() {
  const l = document.getElementById("topbar-compte");
  l.textContent = session ? (moi?.nom || "Mon compte") : "Connexion";
}
sb.auth.onAuthStateChange((evt, s) => setTimeout(() => surChangementSession(evt, s), 0));
async function surChangementSession(evt, s) {
  const avant = !!session; session = s;
  if (evt === "PASSWORD_RECOVERY") {
    const mdp = prompt("Nouveau mot de passe (8 caractères minimum) :");
    if (mdp && mdp.length >= 8) { await sb.auth.updateUser({ password: mdp }); toast("Mot de passe modifié"); }
    location.hash = "#/compte"; return;
  }
  await chargerProfil(); majEntete(); majBadge(); ecouterNouveauxMessages();
  if (evt === "SIGNED_IN" && !avant) {
    const suite = sessionStorage.getItem("apresConnexion"); sessionStorage.removeItem("apresConnexion");
    if (suite && suite !== location.hash) { location.hash = suite; return; }
    if (location.hash.startsWith("#/compte")) router();
  }
  if (evt === "SIGNED_OUT") router();
}

window.addEventListener("hashchange", router);
(async () => {
  const { data } = await sb.auth.getSession(); session = data.session;
  await chargerProfil(); majEntete(); majBadge(); ecouterNouveauxMessages();
  router();
})();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
