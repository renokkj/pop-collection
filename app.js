(() => {
  const $ = (id) => document.getElementById(id);
  const cfg = window.PHOTOCARDS_CONFIG || {};
  const BUCKET = "photocards";

  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const money = (n) => brl.format(Number(n) || 0);
  const cents = (v) => Math.round((parseFloat(String(v ?? "").replace(",", ".")) || 0) * 100) / 100;

  const views = ["authView", "resetView", "appView", "setupView"];
  const show = (id) => views.forEach((v) => ($(v).hidden = v !== id));

  if (!window.supabase || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("SEU-PROJETO")) {
    show("setupView");
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // ---------- estado ----------
  let user = null;
  let cards = [];
  let groups = []; // pedidos de cards da mesma compra
  let groupsById = new Map();
  let folders = []; // pastas do Binder (e, depois, da Wishlist)
  let archived = { total: 0, count: 0 };
  let photoUrls = new Map(); // image_path -> signed url
  let tab = "pay";
  try { const t = localStorage.getItem("pc-tab"); if (["pay", "arr", "col"].includes(t)) tab = t; } catch (e) {}
  // seção aberta (fica no endereço: #inicio, #compras, #financeiro)
  const SECS = ["inicio", "compras", "binder", "wishlist", "financeiro"];
  let sec = SECS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "inicio";
  // filtros de Compras
  const filt = { q: "", artist: "", seller: "", kind: "" };
  let colView = "cards"; // Coleção: "cards" (um por um) ou "groups" (por pedido)
  try { if (localStorage.getItem("pc-colview") === "groups") colView = "groups"; } catch (e) {}
  let loading = true, confirmDelete = null;
  let editing = null, saving = false; // card em edição no formulário
  const busy = new Set();
  let gDetailId = null; // pedido aberto na janela do pedido

  // ---------- categorias de compra ----------
  // Individual Nacional: 1 frete (GOM → você).
  // Individual Internacional: frete até a GOM + frete GOM → você + taxa de importação opcional.
  // CEG Nacional: frete da seller até a GOM (dividido) + frete GOM → você.
  // CEG Internacional: frete até a GOM e taxa opcional (divididos) + frete GOM → você.
  // Na CEG, os valores divididos guardam só a parte da pessoa.
  const isCeg = (t) => t === "ceg";
  const isIntl = (o) => o === "internacional";
  const hasToGom = (t, o) => isCeg(t) || isIntl(o);
  const KIND_NAME = { individual: "Individual", ceg: "CEG" };
  const kindLabel = (c) => `${KIND_NAME[c.purchase_type] || "Individual"} ${isIntl(c.origin) ? "Internacional" : "Nacional"}`;
  function toGomLabel(t, o) {
    if (!isCeg(t)) return "Frete do país de origem até a GOM";
    return isIntl(o) ? "Frete internacional até a GOM · sua parte" : "Frete da seller até a GOM · sua parte";
  }
  const taxLabel = (t) => (isCeg(t) ? "Taxa de importação · sua parte" : "Taxa de importação");

  // ---------- modalidades ----------
  // Só cards de compra têm valores e entram nos totais. Cards antigos são todos compra.
  const isBuy = (c) => (c.kind || "compra") === "compra";
  const buys = () => cards.filter(isBuy);

  // ---------- pedidos ----------
  // Num card com pedido valem só o preço e o "preço pago" do card. Os fretes e a taxa ficam no
  // pedido e contam uma vez só. Os fretes próprios do card ficam guardados e voltam a contar se
  // ele sair do pedido.
  const grp = (c) => (c.group_id && groupsById.get(c.group_id)) || null;
  const members = (g) => cards.filter((c) => c.group_id === g.id);
  function setGroups(list) {
    groups = list;
    groupsById = new Map(groups.map((g) => [g.id, g]));
  }
  const addGroupLocal = (g) => setGroups([g, ...groups.filter((x) => x.id !== g.id)]);

  // fretes e taxa de um card sem pedido ou de um pedido, cada um com o seu "pago"
  function feeParts(src) {
    const p = [];
    if (hasToGom(src.purchase_type, src.origin)) p.push({ key: "shipping_to_gom", paid: "paid_shipping_to_gom", label: "Frete até a GOM", check: "Frete até a GOM pago" });
    if (isIntl(src.origin) && Number(src.import_tax) > 0) p.push({ key: "import_tax", paid: "paid_tax", label: "Taxa de importação", check: "Taxa paga" });
    p.push({ key: "shipping", paid: "paid_shipping", label: "Frete até você", check: "Frete até você pago" });
    return p;
  }
  const sumParts = (src, p) => cents(p.reduce((s, x) => s + (Number(src[x.key]) || 0), 0));
  const dueParts = (src, p) => cents(p.reduce((s, x) => s + (src[x.paid] ? 0 : Number(src[x.key]) || 0), 0));
  const fees = (src) => sumParts(src, feeParts(src));
  const feesDue = (src) => dueParts(src, feeParts(src));
  const feesPaid = (src) => feeParts(src).every((x) => src[x.paid]);

  // partes que o card paga sozinho: o preço e, se não tiver pedido, os próprios fretes e taxa
  function parts(c) {
    const p = [{ key: "price", paid: "paid_price", label: "Preço", check: "Preço pago" }];
    if (!grp(c)) p.push(...feeParts(c));
    return p;
  }
  const allPaid = (c) => parts(c).every((x) => c[x.paid]) && (!grp(c) || feesPaid(grp(c)));
  // presente: sem custo nenhum, vai direto para Chegada
  const stage = (c) => (c.arrived ? "col" : c.gift || allPaid(c) ? "arr" : "pay");
  const total = (c) => sumParts(c, parts(c));
  const due = (c) => dueParts(c, parts(c));
  const sumPrices = (list) => cents(list.reduce((s, c) => s + (Number(c.price) || 0), 0));
  const groupTotal = (g) => cents(sumPrices(members(g)) + fees(g));
  const groupDue = (g) => cents(feesDue(g) + members(g).reduce((s, c) => s + (c.paid_price ? 0 : Number(c.price) || 0), 0));

  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
  }
  function notice(msg) { const n = $("notice"); n.textContent = msg || ""; n.hidden = !msg; }

  // ---------- login / cadastro ----------
  let mode = "login";
  function setMode(m) {
    mode = m;
    document.querySelectorAll("#authView .tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === m)));
    $("aSubmit").textContent = m === "login" ? "Entrar" : m === "signup" ? "Criar conta" : "Enviar link de recuperação";
    $("aPassWrap").hidden = m === "forgot";
    $("aPass").required = m !== "forgot";
    $("aPass").autocomplete = m === "signup" ? "new-password" : "current-password";
    $("aForgot").textContent = m === "forgot" ? "Voltar para o login" : "Esqueci minha senha";
    $("aForgot").hidden = m === "signup";
    authMsg("");
  }
  function authMsg(text, kind = "err", el = "aMsg") {
    const m = $(el); m.textContent = text; m.className = "msg " + kind; m.hidden = !text;
  }
  const PT_ERR = {
    "Invalid login credentials": "E-mail ou senha incorretos.",
    "Email not confirmed": "Confirme seu e-mail pelo link que enviamos antes de entrar.",
    "User already registered": "Já existe uma conta com esse e-mail. Use a aba Entrar.",
    "Password should be at least 6 characters.": "A senha precisa ter pelo menos 6 caracteres.",
  };
  const ptError = (e) => PT_ERR[e?.message] || (e?.status === 429 ? "Muitas tentativas. Espere um pouco e tente de novo." : "Não deu certo: " + (e?.message || "erro desconhecido"));

  document.querySelectorAll("#authView .tabs button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("aForgot").addEventListener("click", () => setMode(mode === "forgot" ? "login" : "forgot"));

  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("aEmail").value.trim(), password = $("aPass").value;
    const btn = $("aSubmit"); btn.disabled = true; authMsg("");
    const redirectTo = location.origin + location.pathname;
    try {
      if (mode === "login") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        if (!data.session) authMsg("Conta criada! Enviamos um link para " + email + ". Confirme o e-mail e depois entre.", "ok");
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        authMsg("Se esse e-mail tiver conta, você vai receber um link para criar uma nova senha.", "ok");
      }
    } catch (err) { authMsg(ptError(err)); }
    finally { btn.disabled = false; }
  });

  $("resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: $("rPass").value });
    if (error) return authMsg(ptError(error), "err", "rMsg");
    history.replaceState(null, "", location.pathname);
    toast("Senha atualizada.");
    enterApp();
  });

  $("logout").addEventListener("click", async () => { await sb.auth.signOut(); });
  $("logoutM").addEventListener("click", async () => { await sb.auth.signOut(); });

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { user = session?.user || null; show("resetView"); return; }
    const next = session?.user || null;
    if (next && (!user || user.id !== next.id)) { user = next; enterApp(); }
    else if (!next) { user = null; cards = []; setGroups([]); photoUrls = new Map(); saving = false; closeForm(); resetForm(); closeGroups(); setMode("login"); show("authView"); }
  });

  function enterApp() {
    $("uEmail").textContent = user.email || "";
    show("appView");
    loading = true; render();
    loadAll();
  }


  // ---------- dados ----------
  async function loadAll() {
    try {
      const [{ data: rows, error: e1 }, { data: st, error: e2 }, { data: gs, error: e3 }, { data: fs, error: e4 }] = await Promise.all([
        sb.from("cards").select("*").order("created_at", { ascending: false }).order("name"),
        sb.from("stats").select("*").maybeSingle(),
        sb.from("card_groups").select("*").order("created_at", { ascending: false }),
        sb.from("folders").select("*").order("position").order("created_at"),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      if (e3) throw e3;
      if (e4) throw e4;
      cards = rows || [];
      folders = fs || [];
      setGroups(gs || []);
      archived = { total: Number(st?.archived_total) || 0, count: Number(st?.archived_count) || 0 };
      await signPhotos();
      notice("");
    } catch (err) {
      notice("Não consegui carregar seus cards. Confira se rodou o arquivo supabase/schema.sql no Supabase e recarregue a página.");
    } finally { loading = false; render(); }
  }

  async function signPhotos() {
    const need = [...cards.map((c) => c.image_path), ...folders.map((f) => f.cover_path)].filter((p) => p && !photoUrls.has(p));
    if (!need.length) return;
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(need, 60 * 60 * 6);
    (data || []).forEach((d) => { if (d.signedUrl) photoUrls.set(d.path, d.signedUrl); });
  }

  // ---------- peças do formulário ----------
  const radio = (name) => (document.querySelector(`input[name=${name}]:checked`) || {}).value;
  const setRadio = (name, v) => document.querySelectorAll(`input[name=${name}]`).forEach((r) => (r.checked = r.value === v));
  const moneyInput = (extra = {}) => el("input", { type: "number", inputmode: "decimal", min: "0", step: "0.01", placeholder: "0,00", ...extra });
  const HINT = {
    "individual-nacional": "Só o frete da GOM até você.",
    "individual-internacional": "Dois fretes: do país de origem até a GOM e da GOM até você. A taxa de importação é opcional e pode ser adicionada depois, em Editar.",
    "ceg-nacional": "O frete da seller até a GOM é dividido: informe só a sua parte. O frete da GOM até você é só seu.",
    "ceg-internacional": "O frete até a GOM e as taxas são divididos conforme as regras da GOM: informe só a sua parte. O frete da GOM até você é só seu.",
  };

  // campos de frete e taxa (usados no card sem pedido e no pedido); campos escondidos contam como zero
  function feeInputs(onInput) {
    const f = { toGom: moneyInput(), tax: moneyInput(), ship: moneyInput(), toGomLabel: el("span"), taxLabel: el("span") };
    f.toGomWrap = el("label", { class: "f" }, f.toGomLabel, f.toGom);
    f.taxWrap = el("label", { class: "f" }, f.taxLabel, f.tax);
    f.shipWrap = el("label", { class: "f" }, el("span", { text: "Frete da GOM até você (R$)" }), f.ship);
    f.nodes = [f.toGomWrap, f.taxWrap, f.shipWrap];
    [f.toGom, f.tax, f.ship].forEach((i) => i.addEventListener("input", onInput));
    f.show = (t, o, on = true) => {
      f.toGomWrap.hidden = !on || !hasToGom(t, o);
      f.toGomLabel.textContent = toGomLabel(t, o) + " (R$)";
      f.taxWrap.hidden = !on || !isIntl(o);
      f.taxLabel.textContent = taxLabel(t) + " (opcional)";
      f.shipWrap.hidden = !on;
    };
    f.values = (t, o) => ({
      shipping_to_gom: hasToGom(t, o) ? cents(f.toGom.value) : 0,
      import_tax: isIntl(o) ? cents(f.tax.value) : 0,
      shipping: cents(f.ship.value),
    });
    f.sum = (t, o) => { const v = f.values(t, o); return cents(v.shipping_to_gom + v.import_tax + v.shipping); };
    f.fill = (src) => {
      f.toGom.value = Number(src.shipping_to_gom) || "";
      f.tax.value = Number(src.import_tax) || "";
      f.ship.value = Number(src.shipping) || "";
    };
    f.empty = () => !f.toGom.value && !f.tax.value && !f.ship.value;
    return f;
  }

  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const s = Math.min(1, 390 / img.width, 600 / img.height);
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      return await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.82));
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------- cadastro de um ou mais photocards ----------
  // Cada card tem foto, nome, vendedor e preço próprios. O tipo e a origem valem para todos.
  // Com pedido, os fretes e a taxa ficam no pedido; sem pedido, cada card tem os seus.
  let entries = [];
  let groupTouched = false; // a pessoa mexeu na escolha de pedido
  const fGroupFees = feeInputs(updateFormTotal);
  $("fGroupFeeFields").append(...fGroupFees.nodes);

  function makeEntry() {
    const e = { photoBlob: null, previewUrl: null, path: null };
    e.name = el("input", { type: "text", placeholder: "ex.: Jisoo · Born Pink · POB Weverse", required: "", maxlength: "120" });
    e.artist = el("input", { type: "text", list: "artistList", placeholder: "ex.: aespa, TWICE", maxlength: "60" });
    e.seller = el("input", { type: "text", list: "sellerList", placeholder: "ex.: GOM, Shopee", maxlength: "80" });
    e.price = moneyInput({ required: "" });
    e.price.addEventListener("input", updateFormTotal);
    e.fees = feeInputs(updateFormTotal);
    e.file = el("input", { type: "file", accept: "image/*", "aria-label": "Foto do photocard (opcional)" });
    e.dropText = el("span", {}, "+ foto", el("br"), "(opcional)", ...(PASTE_KEY ? [el("small", { class: "paste-tip", text: `ou ${PASTE_KEY}` })] : []));
    e.drop = el("label", { class: "drop", title: "Foto opcional" }, e.dropText, e.file);
    e.file.addEventListener("change", () => {
      const file = e.file.files && e.file.files[0];
      if (file) setPhoto(e, file);
    });
    e.num = el("span", { class: "entry-n" });
    e.removeBtn = el("button", { class: "icon-btn", type: "button", text: "Remover", onclick: () => removeEntry(e) });
    e.head = el("div", { class: "entry-head" }, e.num, e.removeBtn);
    e.node = el("div", { class: "entry" }, e.head, e.drop,
      el("div", { class: "fields" },
        el("label", { class: "f name" }, "Nome do photocard", e.name),
        el("label", { class: "f artist" }, "Grupo de K-pop", e.artist),
        el("label", { class: "f seller" }, "Onde comprou (vendedor)", e.seller),
        (e.priceWrap = el("label", { class: "f" }, "Preço (R$)", e.price)),
        ...e.fees.nodes));
    return e;
  }
  async function setPhoto(e, file) {
    try {
      e.photoBlob = await shrink(file);
      if (e.previewUrl) URL.revokeObjectURL(e.previewUrl);
      e.previewUrl = URL.createObjectURL(e.photoBlob);
      showPhoto(e, e.previewUrl);
    } catch (err) { e.photoBlob = null; toast("Não deu para ler essa imagem. Tente um JPG ou PNG."); }
  }
  // Ctrl+V / Cmd+V com uma imagem copiada: vai para o card em que a pessoa está
  // (o campo com o cursor ou o último em que clicou); sem isso, para o primeiro card sem foto.
  const PASTE_KEY = matchMedia("(hover: hover) and (pointer: fine)").matches ? (/Mac|iPhone|iPad/.test(navigator.platform) ? "Cmd+V" : "Ctrl+V") : "";
  let lastEntry = null;
  $("entries").addEventListener("focusin", (ev) => { lastEntry = entries.find((x) => x.node.contains(ev.target)) || lastEntry; });
  $("entries").addEventListener("pointerdown", (ev) => { lastEntry = entries.find((x) => x.node.contains(ev.target)) || lastEntry; });
  function pastedImage(ev) {
    const items = [...((ev.clipboardData && ev.clipboardData.items) || [])];
    const it = items.find((i) => i.kind === "file" && /^image\//.test(i.type));
    return it ? it.getAsFile() : null;
  }
  function showPhoto(e, src) {
    let img = e.drop.querySelector("img");
    if (!img) { img = el("img", { alt: "" }); e.drop.prepend(img); }
    img.src = src;
    e.dropText.hidden = true;
  }
  function addEntry(focus) {
    const prev = entries[entries.length - 1];
    const e = makeEntry();
    entries.push(e);
    if (prev && prev.seller.value) e.seller.value = prev.seller.value;
    if (prev && prev.artist.value) e.artist.value = prev.artist.value;
    $("entries").append(e.node);
    // dois ou mais cards: sugere juntar num pedido novo, levando os fretes já digitados
    if (entries.length === 2 && !groupTouched && $("fGroup").value === "") {
      $("fGroup").value = "new";
      if (fGroupFees.empty()) fGroupFees.fill(prev.fees.values(radio("fType"), radio("fOrigin")));
    }
    updateKindFields();
    if (focus) e.name.focus();
  }
  function removeEntry(e) {
    if (entries.length < 2) return;
    if (e.previewUrl) URL.revokeObjectURL(e.previewUrl);
    e.node.remove();
    entries = entries.filter((x) => x !== e);
    updateKindFields();
  }
  $("addEntry").addEventListener("click", () => addEntry(true));

  function fillGroupSelect() {
    const sel = $("fGroup"), cur = sel.value;
    $("fGroupList").replaceChildren(...groups.map((g) => el("option", { value: g.id, text: g.name })));
    $("fGroupList").hidden = !groups.length;
    sel.value = cur === "new" || groupsById.has(cur) ? cur : "";
  }
  $("fGroup").addEventListener("change", () => {
    groupTouched = true;
    if ($("fGroup").value === "new" && fGroupFees.empty() && entries.length === 1 && !editing)
      fGroupFees.fill(entries[0].fees.values(radio("fType"), radio("fOrigin")));
    updateKindFields();
    if ($("fGroup").value === "new") $("fGroupName").focus();
  });

  // tipo e origem do que está sendo cadastrado (num pedido existente, vêm do pedido)
  function formKind() {
    const mode = $("fGroup").value;
    const g = mode && mode !== "new" ? groupsById.get(mode) : null;
    return { mode, g, gift: $("fGift").checked, t: g ? g.purchase_type : radio("fType") || "individual", o: g ? g.origin : radio("fOrigin") || "nacional" };
  }
  function updateKindFields() {
    const { mode, g, gift, t, o } = formKind();
    // presente num pedido novo: o tipo e a origem valem para o pedido (e os fretes dele)
    $("fTypeWrap").hidden = $("fOriginWrap").hidden = !!g || (gift && mode !== "new");
    $("fHint").textContent = gift ? "Presente: o card não tem custo nenhum e vai direto para a aba Chegada. Num pedido, ele não muda os fretes do pedido." : g ? "" : HINT[t + "-" + o];
    $("fGroupNameWrap").hidden = mode !== "new";
    $("fGroupName").required = mode === "new";
    $("fGroupFees").hidden = mode !== "new";
    fGroupFees.show(t, o);
    entries.forEach((e, i) => {
      e.fees.show(t, o, !mode && !gift);
      e.priceWrap.hidden = gift;
      e.price.required = !gift;
      e.artist.required = !editing;
      e.num.textContent = "Photocard " + (i + 1);
      e.head.hidden = entries.length === 1;
    });
    $("addEntry").hidden = !!editing;
    let hint = "";
    if (g) hint = `${kindLabel(g)}. Os fretes e a taxa já estão no pedido "${g.name}": aqui vai só o preço de cada card.`;
    else if (mode === "new") hint = "Cada card guarda nome, vendedor, preço e foto. Os fretes e a taxa ficam no pedido.";
    else if (entries.length > 1) hint = "Sem pedido, cada card tem os próprios fretes.";
    if (editing && mode && !editing.group_id && fees(editing) > 0)
      hint += ` Os fretes que estavam neste card (${money(fees(editing))}) ficam guardados, mas deixam de contar enquanto ele estiver no pedido.`;
    $("fGroupHint").textContent = hint;
    formLabels();
    updateFormTotal();
  }
  function updateFormTotal() {
    const { mode, gift, t, o } = formKind();
    let sum = gift ? 0 : entries.reduce((s, e) => s + cents(e.price.value) + (mode ? 0 : e.fees.sum(t, o)), 0);
    if (mode === "new") sum += fGroupFees.sum(t, o);
    $("fTotal").textContent = money(sum);
    $("fTotalLabel").textContent = mode === "new" ? "Total do pedido" : mode ? (entries.length > 1 ? "Preço dos cards" : "Preço do card") : "Total";
  }
  document.querySelectorAll("input[name=fType], input[name=fOrigin]").forEach((r) => r.addEventListener("change", updateKindFields));
  $("fGift").addEventListener("change", updateKindFields);

  function formLabels() {
    const n = entries.length;
    const acq = editing && editing.kind === "wishlist"; // "Adquiri este photocard": vira compra
    $("fSubmit").textContent = editing && !acq ? "Salvar alterações" : n > 1 ? `Registrar ${n} photocards` : "Registrar compra";
    const aba = $("fGift").checked ? "Chegada" : "Pagamento";
    $("formMsg").textContent = acq ? `Sai da Wishlist e entra na aba ${aba}.` : editing ? "Editando: " + editing.name : n > 1 ? `Os cards entram na aba ${aba}.` : `O card entra na aba ${aba}.`;
    $("addTitle").textContent = acq ? "Registrar como compra" : editing ? "Editar compra" : "Registrar compra";
    $("addForm").classList.toggle("editing", !!editing);
  }

  // ---------- janela do formulário ----------
  const dlg = $("addDialog");
  dlg.addEventListener("paste", (ev) => {
    const file = pastedImage(ev);
    if (!file || !entries.length) return;
    ev.preventDefault();
    const target = (entries.includes(lastEntry) && lastEntry) || entries.find((x) => !x.photoBlob && !x.drop.querySelector("img")) || entries[entries.length - 1];
    setPhoto(target, file);
  });
  function openForm() {
    fillGroupSelect();
    fFolder.refresh();
    updateKindFields();
    if (!dlg.open) dlg.showModal();
    entries[0].name.focus();
  }
  // fechar mantém o rascunho de cards novos; uma edição é descartada
  function closeForm() {
    if (saving) return;
    if (dlg.open) dlg.close();
  }
  // fechar sem salvar (Cancelar, ✕, Esc ou clique fora) descarta o que foi digitado
  dlg.addEventListener("close", () => { if (!saving) resetForm(); });
  dlg.addEventListener("cancel", (e) => { if (saving) e.preventDefault(); }); // tecla Esc
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeForm(); }); // clique fora da janela
  $("addClose").addEventListener("click", closeForm);
  function openNewBuy() { if (editing) resetForm(); openForm(); }
  $("openAdd").addEventListener("click", openNewBuy);
  function startEdit(c) {
    if (saving) return;
    resetForm();
    editing = c;
    groupTouched = true;
    fillGroupSelect();
    const e = entries[0];
    e.name.value = c.name;
    e.seller.value = c.seller || "";
    e.artist.value = c.artist || "";
    const acq = c.kind === "wishlist";
    $("fDate").value = acq ? today() : c.purchased_on || "";
    $("fExpected").value = c.expected_on || "";
    e.price.value = acq ? "" : Number(c.price);
    e.fees.fill(c);
    setRadio("fType", c.purchase_type || "individual");
    setRadio("fOrigin", c.origin || "nacional");
    $("fGroup").value = grp(c) ? c.group_id : "";
    $("fGift").checked = !!c.gift;
    fFolder.set(acq ? "" : c.folder_id); // pasta da Wishlist não vale no Binder
    const src = c.image_path && photoUrls.get(c.image_path);
    if (src) showPhoto(e, src);
    openForm();
    if (acq) e.price.focus(); // da Wishlist: só falta o preço
  }
  $("fCancel").addEventListener("click", closeForm);
  function resetForm() {
    editing = null; groupTouched = false;
    entries.forEach((e) => { if (e.previewUrl) URL.revokeObjectURL(e.previewUrl); });
    entries = [];
    $("entries").replaceChildren();
    $("addForm").reset();
    $("fDate").value = today();
    if (typeof fFolder !== "undefined") fFolder.set("");
    addEntry(false);
  }

  $("addForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const { mode, gift, t, o } = formKind();
    const groupName = $("fGroupName").value.trim();
    if (mode === "new" && !groupName) { $("fGroupName").focus(); return; }
    const blank = entries.find((e) => !e.name.value.trim());
    if (blank) { blank.name.focus(); return; }
    const noArtist = !editing && entries.find((e) => !e.artist.value.trim());
    if (noArtist) { noArtist.artist.focus(); return; }
    if (fFolder.needsName()) { fFolder.name.focus(); return; }
    const target = editing;
    saving = true;
    $("fSubmit").disabled = true; $("fCancel").disabled = true; $("formMsg").textContent = "Salvando…";
    let created = null;
    const uploaded = [];
    try {
      if (mode === "new") {
        const { data, error } = await sb.from("card_groups")
          .insert({ name: groupName, purchase_type: t, origin: o, ...fGroupFees.values(t, o) }).select().single();
        if (error) throw error;
        created = data;
      }
      const g = created || (mode ? groupsById.get(mode) : null);
      const folder_id = await fFolder.value();
      let photoFails = 0;
      await Promise.all(entries.map(async (e) => {
        e.path = null;
        if (!e.photoBlob) return;
        const path = `${user.id}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from(BUCKET).upload(path, e.photoBlob, { contentType: "image/jpeg" });
        if (error) photoFails++;
        else { e.path = path; uploaded.push(path); }
      }));
      // num pedido, os fretes próprios do card não são tocados (ficam guardados)
      const values = (e) => {
        const base = { name: e.name.value.trim(), seller: e.seller.value.trim() || null, artist: artistName(e.artist.value),
          purchased_on: $("fDate").value || today(), expected_on: $("fExpected").value || null, folder_id };
        // presente: zera os valores e marca tudo como pago
        if (gift) return { ...base, gift: true, group_id: g ? g.id : null, purchase_type: g ? g.purchase_type : t, origin: g ? g.origin : o, price: 0, shipping: 0, shipping_to_gom: 0, import_tax: 0,
          paid_price: true, paid_shipping: true, paid_shipping_to_gom: true, paid_tax: true };
        const v = { ...base, gift: false, price: cents(e.price.value), group_id: g ? g.id : null };
        if (!g) Object.assign(v, { purchase_type: t, origin: o, ...e.fees.values(t, o) });
        // deixou de ser presente: os valores voltam a ser pagos normalmente
        if (target && target.gift) Object.assign(v, { paid_price: false, paid_shipping: false, paid_shipping_to_gom: false, paid_tax: false });
        return v;
      };
      const keepPreview = (e) => { if (e.path && e.previewUrl) { photoUrls.set(e.path, e.previewUrl); e.previewUrl = null; } };

      if (target) {
        // edição: mantém os pagamentos e a aba do card; a foto só muda se uma nova foi enviada
        const e = entries[0], v = values(e);
        if (e.path) v.image_path = e.path;
        const acq = target.kind === "wishlist";
        // saiu da Wishlist: vira compra em Pagamento (ou Chegada, se for presente)
        if (acq) Object.assign(v, { kind: "compra", arrived: false, arrived_at: null, in_binder: true },
          gift ? {} : { paid_price: false, paid_shipping: false, paid_shipping_to_gom: false, paid_tax: false });
        const oldPath = target.image_path;
        const wasStage = stage(target);
        const { data, error } = await sb.from("cards").update(v).eq("id", target.id).select().single();
        if (error) throw error;
        if (created) addGroupLocal(created);
        if (e.path && oldPath) sb.storage.from(BUCKET).remove([oldPath]);
        Object.assign(target, data);
        const backToPay = wasStage === "arr" && stage(target) === "pay";
        keepPreview(e);
        saving = false; resetForm(); closeForm();
        if (acq) { toast(`Saiu da Wishlist e virou compra em ${gift ? "Chegada" : "Pagamento"}.`); go("compras", gift ? "arr" : "pay"); return; }
        toast(photoFails ? "Dados salvos, mas a nova foto não foi enviada." : backToPay ? "Alterações salvas. O card voltou para Pagamento." : "Alterações salvas.");
        render();
        return;
      }
      const rows = entries.map((e) => {
        const v = { ...values(e), image_path: e.path };
        if (g && !gift) { v.purchase_type = g.purchase_type; v.origin = g.origin; }
        return v;
      });
      const { data, error } = await sb.from("cards").insert(rows).select();
      if (error) throw error;
      if (created) addGroupLocal(created);
      entries.forEach(keepPreview);
      cards.unshift(...data);
      const n = data.length;
      saving = false; resetForm(); closeForm();
      const what = n > 1 ? `${n} photocards registrados` : "Compra registrada";
      toast((photoFails ? `${what}, mas ${plural(photoFails, "foto não foi enviada", "fotos não foram enviadas")}.` : `${what} em ${gift ? "Chegada" : "Pagamento"}.`) + (g ? ` Pedido: ${g.name}.` : ""));
      tab = gift ? "arr" : "pay"; render();
      signPhotos().then(render);
    } catch (err) {
      if (uploaded.length) sb.storage.from(BUCKET).remove(uploaded);
      if (created) sb.from("card_groups").delete().eq("id", created.id);
      toast("Não foi possível salvar. Tente de novo.");
    } finally {
      saving = false;
      $("fSubmit").disabled = false; $("fCancel").disabled = false; formLabels();
    }
  });

  // ---------- janela de pedidos (lista + criar/editar) ----------
  const gdlg = $("groupDialog");
  const gFees = feeInputs(updateGroupTotal);
  $("gFeeFields").append(...gFees.nodes);
  let gEditing = null, gFromList = false, gMembers = new Set(), gSaving = false, gOwnAdded = false;

  function openGroups() { showGroupList(); if (!gdlg.open) gdlg.showModal(); }
  function closeGroups() { if (!gSaving && gdlg.open) gdlg.close(); }
  function showGroupList() {
    gEditing = null; gDetailId = null;
    $("gListView").hidden = false; $("gForm").hidden = true; $("gDetailView").hidden = true; $("gBack").hidden = true;
    $("gTitle").textContent = "Pedidos";
    renderGroupList();
  }
  function renderGroupList() {
    const box = $("gItems");
    if (!groups.length) {
      box.replaceChildren(el("div", { class: "empty" }, el("strong", { text: "Nenhum pedido ainda" }),
        el("span", { text: "Crie um pedido para juntar cards da mesma compra, mesmo que já estejam cadastrados." })));
      return;
    }
    box.replaceChildren(...groups.map((g) => {
      const m = members(g);
      return el("div", { class: "gitem" }, stack(m),
        el("div", { class: "info" },
          el("span", { class: "title", text: g.name }),
          el("span", { class: "tag", text: kindLabel(g) }),
          el("span", { class: "from" }, document.createTextNode(plural(m.length, "card", "cards") + " · "), el("b", { class: "num", text: money(groupTotal(g)) }))),
        el("div", { class: "gitem-btns" },
          el("button", { class: "btn-ghost", type: "button", text: "Ver", "aria-label": "Ver os cards do pedido " + g.name, onclick: () => openGroupDetail(g, true) }),
          el("button", { class: "btn-ghost", type: "button", text: "Editar", "aria-label": "Editar o pedido " + g.name, onclick: () => openGroupForm(g, true) })));
    }));
  }
  // janela do pedido: abre ao clicar no pedido nas abas ou em "Ver" no botão Pedidos.
  // Mostra os valores do pedido, os fretes e a taxa para marcar como pagos e cada card
  // com as mesmas ações da aba em que ele está (pagar, chegou, editar, excluir).
  function openGroupDetail(g, fromList) {
    showGroupDetail(g, fromList);
    if (!gdlg.open) gdlg.showModal();
    $("gDetailView").scrollTop = 0;
  }
  function showGroupDetail(g, fromList) {
    gDetailId = g.id; gEditing = null;
    if (fromList !== undefined) $("gBack").hidden = !fromList;
    const m = members(g);
    const d = groupDue(g);
    const status = el("div", { class: "status" },
      el("div", { class: "checks" }, ...feeParts(g).map((x) => check(x.check, g[x.paid], (v) => patchGroup(g, { [x.paid]: v })))),
      d > 0 ? el("span", { class: "pill warn" }, document.createTextNode("Falta pagar no pedido "), el("b", { class: "num", text: money(d) }))
        : el("span", { class: "pill ok", text: "Pedido pago" }));
    const head = el("div", { class: "gdetail-head" }, stack(m),
      el("div", { class: "info" }, el("span", { class: "tag tag-group", text: "Pedido · " + kindLabel(g) }), groupMoney(g, m)),
      status);
    const sections = [["pay", "Em Pagamento", rowPay], ["arr", "Em Chegada", rowArr], ["col", "Chegaram", rowCol]].map(([st, name, fn]) => {
      const list = m.filter((c) => stage(c) === st);
      if (!list.length) return null;
      const all = st === "arr" && list.length > 1 ? el("button", { class: "btn-ok", type: "button", text: `Todos os ${list.length} chegaram ✓`,
        onclick: () => patchMany(list, { arrived: true, arrived_at: new Date().toISOString() }, `${list.length} cards chegaram! Já estão no Binder.`) }) : null;
      return el("section", { class: "gsection" },
        el("div", { class: "gsection-head" }, el("h3", {}, document.createTextNode(name + " "), el("span", { class: "count", text: list.length })), all),
        el("div", { class: "table" }, ...list.map((c) => fn(c, true))));
    }).filter(Boolean);
    $("gDetailView").replaceChildren(head,
      ...(sections.length ? sections : [el("div", { class: "empty" }, el("span", { text: "Nenhum card neste pedido ainda. Adicione em Editar, no botão Pedidos." }))]));
    $("gTitle").textContent = g.name;
    $("gListView").hidden = true; $("gForm").hidden = true; $("gDetailView").hidden = false;
  }
  function openGroupForm(g, fromList) {
    if (saving) return;
    gEditing = g || null; gFromList = fromList; gOwnAdded = false; gDetailId = null;
    gMembers = new Set(g ? members(g).map((c) => c.id) : []);
    $("gForm").reset();
    $("gName").value = g ? g.name : "";
    setRadio("gType", g ? g.purchase_type : "individual");
    setRadio("gOrigin", g ? g.origin : "nacional");
    gFees.fill(g || {});
    $("gTitle").textContent = g ? "Editar pedido" : "Novo pedido";
    $("gSubmit").textContent = g ? "Salvar pedido" : "Criar pedido";
    $("gDelete").hidden = !g;
    $("gDelConfirm").hidden = true;
    $("gListView").hidden = true; $("gDetailView").hidden = true; $("gForm").hidden = false; $("gBack").hidden = !fromList;
    $("gSearch").hidden = buys().length < 8;
    updateGroupKind();
    renderPicker();
    if (!gdlg.open) gdlg.showModal();
    $("gName").focus();
  }
  function gKind() { return { t: radio("gType") || "individual", o: radio("gOrigin") || "nacional" }; }
  function updateGroupKind() {
    const { t, o } = gKind();
    gFees.show(t, o);
    $("gHint").textContent = HINT[t + "-" + o].replace("em Editar", "em Editar, no botão Pedidos");
    updateGroupTotal();
  }
  document.querySelectorAll("input[name=gType], input[name=gOrigin]").forEach((r) => r.addEventListener("change", updateGroupKind));

  const STAGE_NAME = { pay: "Pagamento", arr: "Chegada", col: "Chegou" };
  // um card fica em um pedido só: no criar/editar pedido, os de outro pedido aparecem bloqueados
  const otherGroup = (c) => (grp(c) && (!gEditing || c.group_id !== gEditing.id) ? grp(c) : null);
  function renderPicker() {
    const q = $("gSearch").value.trim().toLowerCase();
    const list = buys().filter((c) => !q || c.name.toLowerCase().includes(q))
      // os do pedido primeiro, depois os sem pedido; os que já estão em outro pedido vão por último
      .sort((a, b) => (gMembers.has(b.id) - gMembers.has(a.id)) || (!!otherGroup(a) - !!otherGroup(b)));
    const box = $("gPicker");
    if (!list.length) {
      box.replaceChildren(el("p", { class: "hint", text: cards.length ? "Nenhum card com esse nome." : "Você ainda não tem compras. Registre pelo botão \"+ Registrar compra\"." }));
      return;
    }
    box.replaceChildren(...list.map((c) => {
      const other = otherGroup(c);
      const input = el("input", { type: "checkbox", disabled: other ? "" : null });
      input.checked = !other && gMembers.has(c.id);
      input.addEventListener("change", () => {
        input.checked ? gMembers.add(c.id) : gMembers.delete(c.id);
        item.classList.toggle("on", input.checked);
        updateGroupTotal();
      });
      const item = el("label", { class: "pick" + (input.checked ? " on" : "") + (other ? " locked" : ""), title: other ? `Este card já está no pedido "${other.name}". Para trocar, tire ele de lá primeiro.` : null }, input, thumb(c),
        el("span", { class: "pick-info" },
          el("span", { class: "title", text: c.name }),
          el("span", { class: "from", text: [c.gift ? "Presente" : money(c.price), STAGE_NAME[stage(c)]].join(" · ") }),
          other ? el("span", { class: "tag tag-group", text: `Já está no pedido "${other.name}"` }) : null));
      return item;
    }));
  }
  $("gSearch").addEventListener("input", renderPicker);

  function updateGroupTotal() {
    const { t, o } = gKind();
    const sel = cards.filter((c) => gMembers.has(c.id));
    $("gTotal").textContent = money(sumPrices(sel) + gFees.sum(t, o));
    $("gCount").textContent = sel.length;
    // cards sem pedido que tinham fretes próprios: avisa e oferece somar nos fretes do pedido
    const own = sel.filter((c) => !c.group_id && fees(c) > 0);
    const box = $("gOwnFees");
    box.hidden = !own.length;
    if (!own.length) return;
    const ownSum = cents(own.reduce((s, c) => s + fees(c), 0));
    if (gOwnAdded) { box.replaceChildren(el("span", { text: "Somamos os fretes desses cards nos fretes do pedido. Confira os valores acima." })); return; }
    box.replaceChildren(
      el("span", { text: `${own.length === 1 ? "1 card marcado tem" : own.length + " cards marcados têm"} fretes próprios (${money(ownSum)}). No pedido eles deixam de contar, mas ficam guardados caso o card saia do pedido.` }),
      el("button", { class: "btn-ghost", type: "button", text: "Somar nos fretes do pedido", onclick: () => {
        const add = (input, key) => { const v = cents(cents(input.value) + own.reduce((s, c) => s + (feeParts(c).some((x) => x.key === key) ? Number(c[key]) || 0 : 0), 0)); input.value = v || ""; };
        add(gFees.toGom, "shipping_to_gom"); add(gFees.tax, "import_tax"); add(gFees.ship, "shipping");
        gOwnAdded = true; updateGroupTotal();
      } }));
  }

  function setGroupBusy(on) {
    gSaving = on;
    ["gSubmit", "gCancel", "gDelete"].forEach((id) => ($(id).disabled = on));
  }
  $("gForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = $("gName").value.trim();
    if (!name) { $("gName").focus(); return; }
    const { t, o } = gKind();
    const values = { name, purchase_type: t, origin: o, ...gFees.values(t, o) };
    const wasNew = !gEditing;
    setGroupBusy(true);
    try {
      let g;
      if (gEditing) {
        const { data, error } = await sb.from("card_groups").update(values).eq("id", gEditing.id).select().single();
        if (error) throw error;
        g = Object.assign(gEditing, data);
      } else {
        const { data, error } = await sb.from("card_groups").insert(values).select().single();
        if (error) throw error;
        g = data; addGroupLocal(g);
      }
      const add = cards.filter((c) => gMembers.has(c.id) && !c.group_id); // nunca tira um card de outro pedido
      const rem = cards.filter((c) => c.group_id === g.id && !gMembers.has(c.id));
      if (add.length) {
        const { error } = await sb.from("cards").update({ group_id: g.id }).in("id", add.map((c) => c.id));
        if (error) throw error;
        add.forEach((c) => (c.group_id = g.id));
      }
      if (rem.length) {
        const { error } = await sb.from("cards").update({ group_id: null }).in("id", rem.map((c) => c.id));
        if (error) throw error;
        rem.forEach((c) => (c.group_id = null));
      }
      setGroupBusy(false);
      toast(wasNew ? `Pedido "${g.name}" criado com ${plural(gMembers.size, "card", "cards")}.` : "Pedido salvo.");
      gFromList ? showGroupList() : closeGroups();
      render();
    } catch (err) {
      setGroupBusy(false);
      toast("Não foi possível salvar o pedido. Tente de novo.");
      loadAll();
    }
  });
  $("gDelete").addEventListener("click", () => {
    const g = gEditing; if (!g) return;
    const n = members(g).length, f = fees(g);
    $("gDelConfirm").replaceChildren(
      el("span", { text: `Excluir o pedido "${g.name}"? ${n === 1 ? "O card continua cadastrado, só fica sem pedido." : n ? `Os ${n} cards continuam cadastrados, só ficam sem pedido.` : ""}${f > 0 ? ` Os fretes e a taxa do pedido (${money(f)}) deixam de ser somados.` : ""}` }),
      el("button", { class: "btn-danger", type: "button", style: "background:var(--danger);color:var(--surface)", text: "Sim, excluir pedido", onclick: () => deleteGroup(g) }),
      el("button", { class: "btn-ghost", type: "button", text: "Cancelar", onclick: () => ($("gDelConfirm").hidden = true) }));
    $("gDelConfirm").hidden = false;
  });
  async function deleteGroup(g) {
    setGroupBusy(true);
    const { error } = await sb.from("card_groups").delete().eq("id", g.id);
    setGroupBusy(false);
    if (error) { toast("Não foi possível excluir o pedido."); return; }
    cards.forEach((c) => { if (c.group_id === g.id) c.group_id = null; });
    setGroups(groups.filter((x) => x.id !== g.id));
    toast("Pedido excluído. Os cards continuam cadastrados.");
    gFromList ? showGroupList() : closeGroups();
    render();
  }
  $("openGroups").addEventListener("click", openGroups);

  // ---------- botão flutuante do celular ----------
  // Em Compras, no Binder e na Wishlist o + abre direto o cadastro daquela seção; nas outras, as opções.
  function setFab(open) {
    $("fabMenu").hidden = !open; $("fabShade").hidden = !open;
    $("fabMain").setAttribute("aria-expanded", String(open));
    $("fabMain").setAttribute("aria-label", open ? "Fechar opções" : sec === "compras" ? "Registrar compra" : sec === "binder" ? "Adicionar ao Binder" : sec === "wishlist" ? "Adicionar à Wishlist" : "Abrir opções de cadastro");
  }
  function addAction(kind) {
    setFab(false); setSideMenu(false);
    if (kind === "binder" || kind === "wishlist") openBinderForm(null, kind);
    else openNewBuy();
  }
  $("fabMain").addEventListener("click", () => {
    if (!$("fabMenu").hidden) return setFab(false);
    if (sec === "compras") return addAction("buy");
    if (sec === "binder" || sec === "wishlist") return addAction(sec);
    setFab(true);
  });
  document.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => addAction(b.dataset.add)));
  // computador: o "+ Novo" da barra lateral abre as mesmas opções
  function setSideMenu(open) { $("sideMenu").hidden = !open; $("sideAdd").setAttribute("aria-expanded", String(open)); }
  $("sideAdd").addEventListener("click", () => setSideMenu($("sideMenu").hidden));
  document.addEventListener("click", (e) => { if (!$("sideMenu").hidden && !e.target.closest(".side-new")) setSideMenu(false); });
  $("fabShade").addEventListener("click", () => setFab(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!$("fabMenu").hidden) setFab(false); setSideMenu(false); } });
  $("fabGroups").addEventListener("click", () => { setFab(false); openGroups(); });
  $("gNew").addEventListener("click", () => openGroupForm(null, true));
  $("gBack").addEventListener("click", () => { if (!gSaving) showGroupList(); });
  $("gCancel").addEventListener("click", () => { if (gSaving) return; gFromList ? showGroupList() : closeGroups(); });
  $("gClose").addEventListener("click", closeGroups);
  gdlg.addEventListener("close", () => { gDetailId = null; });
  gdlg.addEventListener("cancel", (e) => { if (gSaving) e.preventDefault(); });
  gdlg.addEventListener("click", (e) => { if (e.target === gdlg) closeGroups(); });

  // ---------- abas ----------
  function setTab(t) {
    tab = t; confirmDelete = null;
    try { localStorage.setItem("pc-tab", t); } catch (e) {}
    render();
  }
  document.querySelectorAll("#mainTabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  function setColView(v) {
    colView = v;
    try { localStorage.setItem("pc-colview", v); } catch (e) {}
    render();
  }

  // ---------- ações ----------
  async function patch(c, changes, msg) {
    if (busy.has(c.id)) return;
    busy.add(c.id);
    const before = { ...c };
    Object.assign(c, changes); render();
    const { error } = await sb.from("cards").update(changes).eq("id", c.id);
    busy.delete(c.id);
    if (error) { Object.assign(c, before); toast("Não foi possível atualizar. Tente de novo."); }
    else if (msg) toast(msg);
    render();
  }
  // muda vários cards de uma vez (ex.: "Todos chegaram")
  async function patchMany(list, changes, msg) {
    const ids = list.map((c) => c.id).filter((id) => !busy.has(id));
    if (!ids.length) return;
    const sel = list.filter((c) => ids.includes(c.id));
    ids.forEach((id) => busy.add(id));
    const before = sel.map((c) => ({ ...c }));
    sel.forEach((c) => Object.assign(c, changes)); render();
    const { error } = await sb.from("cards").update(changes).in("id", ids);
    ids.forEach((id) => busy.delete(id));
    if (error) { sel.forEach((c, i) => Object.assign(c, before[i])); toast("Não foi possível atualizar. Tente de novo."); }
    else if (msg) toast(msg);
    render();
  }
  // fretes e taxa do pedido: marcar como pago vale para todos os cards dele
  async function patchGroup(g, changes) {
    const key = "g:" + g.id;
    if (busy.has(key)) return;
    busy.add(key);
    const before = { ...g };
    const wasPay = members(g).filter((c) => stage(c) === "pay");
    Object.assign(g, changes); render();
    const { error } = await sb.from("card_groups").update(changes).eq("id", g.id);
    busy.delete(key);
    if (error) { Object.assign(g, before); toast("Não foi possível atualizar. Tente de novo."); }
    else {
      const moved = wasPay.filter((c) => stage(c) === "arr").length;
      if (moved) toast(`Tudo pago! ${moved === 1 ? "1 card foi" : moved + " cards foram"} para Chegada.`);
    }
    render();
  }
  async function removeCard(c) {
    const { error } = await sb.from("cards").delete().eq("id", c.id);
    if (error) { toast("Não foi possível apagar."); return; }
    if (c.image_path) sb.storage.from(BUCKET).remove([c.image_path]);
    cards = cards.filter((x) => x.id !== c.id);
    if (editing && editing.id === c.id) { resetForm(); closeForm(); }
    toast("Card apagado.");
    render();
  }
  // ---------- Binder ----------
  // No Binder ficam os cards cadastrados direto nele e as compras que chegaram
  // (a não ser que a pessoa tenha tirado a compra do Binder: in_binder = false).
  const inBinder = (c) => c.kind === "binder" || (isBuy(c) && c.arrived && c.in_binder !== false);
  const addedAt = (c) => c.arrived_at || c.created_at || "";
  const binderCards = () => cards.filter(inBinder).sort((a, b) => addedAt(b).localeCompare(addedAt(a)));
  const folderById = (id) => folders.find((f) => f.id === id) || null;
  const scopeFolders = (scope) => folders.filter((f) => f.scope === scope);
  // Wishlist: os cards que a pessoa quer ter, mais recentes primeiro
  const isWish = (c) => c.kind === "wishlist";
  const wishCards = () => cards.filter(isWish).sort((a, b) => (b.wished_at || b.created_at || "").localeCompare(a.wished_at || a.created_at || ""));
  // a mesma tela (grade, pastas, seleção) serve ao Binder e à Wishlist
  const curScope = () => (sec === "wishlist" ? "wishlist" : "binder");
  const scopeCards = (scope) => (scope === "wishlist" ? wishCards() : binderCards());
  const SCOPE_NAME = { binder: "Binder", wishlist: "Wishlist" };
  const bFolderBy = { binder: "all", wishlist: "all" };
  let bScope = "binder";
  let bFolder = "all"; // "all", "none" ou o id da pasta aberta
  const bFilt = { q: "", artist: "" };
  let selecting = false;
  const selected = new Set();

  async function createFolder(name, scope) {
    const position = scopeFolders(scope).reduce((m, f) => Math.max(m, f.position || 0), 0) + 1;
    const { data, error } = await sb.from("folders").insert({ name, scope, position }).select().single();
    if (error) throw error;
    folders.push(data);
    return data;
  }

  // campo "Pasta" com "+ Nova pasta" que cria a pasta sem sair do formulário
  function folderPicker(wrap, scope, label) {
    // o escopo pode mudar depois (o mesmo cadastro serve ao Binder e à Wishlist)
    const sel = el("select", {});
    const name = el("input", { type: "text", placeholder: "Nome da nova pasta", maxlength: "60", "aria-label": "Nome da nova pasta", hidden: "" });
    wrap.replaceChildren(el("label", { class: "f" }, label, sel), name);
    wrap.classList.add("folderpick");
    const p = {
      refresh(keep) {
        const cur = keep !== undefined ? keep : sel.value;
        sel.replaceChildren(el("option", { value: "", text: "Sem pasta" }), el("option", { value: "new", text: "+ Nova pasta" }),
          ...scopeFolders(p.scope).map((f) => el("option", { value: f.id, text: f.name })));
        sel.value = cur === "new" || folderById(cur) ? cur : "";
        name.hidden = sel.value !== "new";
      },
      set(id) { name.value = ""; p.refresh(id || ""); },
      // devolve o id da pasta (criando a nova, se for o caso) ou null
      async value() {
        if (sel.value !== "new") return sel.value || null;
        const n = name.value.trim();
        if (!n) return null;
        const f = await createFolder(n, p.scope);
        p.refresh(f.id);
        return f.id;
      },
      needsName: () => sel.value === "new" && !name.value.trim(),
      name, scope,
    };
    sel.addEventListener("change", () => { name.hidden = sel.value !== "new"; if (!name.hidden) name.focus(); });
    p.refresh("");
    return p;
  }
  const fFolder = folderPicker($("fFolderWrap"), "binder", "Pasta no Binder (opcional)");

  // ---------- cadastro direto no Binder ----------
  const bdlg = $("binderDialog");
  const bdFolder = folderPicker($("bdFolderWrap"), "binder", "Pasta (opcional)");
  let bdEntries = [], bdEditing = null, bdSaving = false, bdLast = null, bdScope = "binder";
  function makeBEntry() {
    const e = { photoBlob: null, previewUrl: null, path: null };
    e.name = el("input", { type: "text", placeholder: "ex.: Karina · Armageddon POB", maxlength: "120" });
    e.artist = el("input", { type: "text", list: "artistList", placeholder: "ex.: aespa, TWICE", maxlength: "60" });
    e.file = el("input", { type: "file", accept: "image/*", "aria-label": "Foto do photocard" });
    e.dropText = el("span", {}, "+ foto", ...(PASTE_KEY ? [el("small", { class: "paste-tip", text: `ou ${PASTE_KEY}` })] : []));
    e.drop = el("label", { class: "drop", title: "Foto do photocard" }, e.dropText, e.file);
    e.file.addEventListener("change", () => { const f = e.file.files && e.file.files[0]; if (f) setPhoto(e, f); });
    e.num = el("span", { class: "entry-n" });
    e.removeBtn = el("button", { class: "icon-btn", type: "button", text: "Remover", onclick: () => {
      if (bdEntries.length < 2) return;
      if (e.previewUrl) URL.revokeObjectURL(e.previewUrl);
      e.node.remove(); bdEntries = bdEntries.filter((x) => x !== e); bdLabels();
    } });
    e.head = el("div", { class: "entry-head" }, e.num, e.removeBtn);
    e.node = el("div", { class: "entry" }, e.head, e.drop,
      el("div", { class: "fields fields-2" },
        el("label", { class: "f name" }, "Nome do photocard", e.name),
        el("label", { class: "f artist" }, "Grupo de K-pop", e.artist)));
    const mark = () => (bdLast = e);
    e.node.addEventListener("focusin", mark); e.node.addEventListener("pointerdown", mark);
    return e;
  }
  function bdAdd(focus) {
    const prev = bdEntries[bdEntries.length - 1];
    const e = makeBEntry();
    if (prev && prev.artist.value) e.artist.value = prev.artist.value;
    bdEntries.push(e); $("bdEntries").append(e.node);
    bdLabels();
    if (focus) e.name.focus();
  }
  function bdLabels() {
    const n = bdEntries.length;
    bdEntries.forEach((e, i) => { e.num.textContent = "Photocard " + (i + 1); e.head.hidden = n === 1; });
    $("bdMore").hidden = !!bdEditing;
    const to = bdScope === "wishlist" ? "à Wishlist" : "ao Binder";
    $("bdTitle").textContent = bdEditing ? "Editar photocard" : "Adicionar " + to;
    $("bdSubmit").textContent = bdEditing ? "Salvar alterações" : n > 1 ? `Adicionar ${n} photocards` : "Adicionar " + to;
    $("bdHint").textContent = bdScope === "wishlist" ? "Os cards que você quer ter. Quando conseguir um, abra o card e toque em \"Adquiri este photocard\"." : "Para os cards que você já tem. Não pede valores e não entra nos totais.";
    $("bdMsg").textContent = bdEditing ? "" : n > 1 ? `${n} cards` : "";
  }
  function bdReset() {
    bdEntries.forEach((e) => { if (e.previewUrl) URL.revokeObjectURL(e.previewUrl); });
    bdEntries = []; bdEditing = null; bdLast = null;
    $("bdEntries").replaceChildren(); $("bdErr").hidden = true;
    bdFolder.scope = bdScope;
    const here = sec === bdScope && bFolder !== "all" && bFolder !== "none" ? bFolder : "";
    bdFolder.set(here);
    bdAdd(false);
  }
  function openBinderForm(c, scope) {
    if (bdSaving) return;
    bdScope = c ? (isWish(c) ? "wishlist" : "binder") : scope || curScope();
    bdReset();
    if (c) {
      bdEditing = c;
      const e = bdEntries[0];
      e.name.value = c.name; e.artist.value = c.artist || "";
      const src = c.image_path && photoUrls.get(c.image_path);
      if (src) showPhoto(e, src);
      bdFolder.set(c.folder_id);
    }
    bdLabels();
    if (!bdlg.open) bdlg.showModal();
    bdEntries[0].name.focus();
  }
  function closeBinderForm() { if (!bdSaving && bdlg.open) bdlg.close(); }
  bdlg.addEventListener("close", () => { if (!bdSaving) bdReset(); });
  bdlg.addEventListener("cancel", (e) => { if (bdSaving) e.preventDefault(); });
  bdlg.addEventListener("click", (e) => { if (e.target === bdlg) closeBinderForm(); });
  bdlg.addEventListener("paste", (ev) => {
    const file = pastedImage(ev);
    if (!file) return;
    ev.preventDefault();
    const target = (bdEntries.includes(bdLast) && bdLast) || bdEntries.find((x) => !x.photoBlob && !x.drop.querySelector("img")) || bdEntries[bdEntries.length - 1];
    setPhoto(target, file);
  });
  $("bdClose").addEventListener("click", closeBinderForm);
  $("bdCancel").addEventListener("click", closeBinderForm);
  $("bdMore").addEventListener("click", () => bdAdd(true));
  $("bAdd").addEventListener("click", () => openBinderForm(null, curScope()));
  function bdError(msg, focus) {
    $("bdErr").textContent = msg; $("bdErr").hidden = false;
    if (focus) focus.focus();
  }
  $("bdForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("bdErr").hidden = true;
    for (const e of bdEntries) {
      if (!e.photoBlob && !e.drop.querySelector("img")) return bdError("Falta a foto" + (bdEntries.length > 1 ? " de um dos cards." : "."), e.drop.querySelector("input"));
      if (!e.name.value.trim()) return bdError("Falta o nome do photocard.", e.name);
      if (!e.artist.value.trim()) return bdError("Falta o grupo de K-pop.", e.artist);
    }
    if (bdFolder.needsName()) return bdError("Dê um nome para a pasta nova.", bdFolder.name);
    bdSaving = true;
    $("bdSubmit").disabled = $("bdCancel").disabled = true;
    const uploaded = [];
    try {
      const folder_id = await bdFolder.value();
      for (const e of bdEntries) {
        e.path = null;
        if (!e.photoBlob) continue;
        const path = `${user.id}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from(BUCKET).upload(path, e.photoBlob, { contentType: "image/jpeg" });
        if (error) throw error;
        e.path = path; uploaded.push(path);
      }
      const keep = (e) => { if (e.path && e.previewUrl) { photoUrls.set(e.path, e.previewUrl); e.previewUrl = null; } };
      if (bdEditing) {
        const e = bdEntries[0], c = bdEditing;
        const v = { name: e.name.value.trim(), artist: artistName(e.artist.value), folder_id };
        if (e.path) v.image_path = e.path;
        const { data, error } = await sb.from("cards").update(v).eq("id", c.id).select().single();
        if (error) throw error;
        if (e.path && c.image_path) sb.storage.from(BUCKET).remove([c.image_path]);
        Object.assign(c, data); keep(e);
        toast("Alterações salvas.");
      } else {
        const now = new Date().toISOString();
        const wish = bdScope === "wishlist";
        const rows = bdEntries.map((e) => ({ kind: bdScope, name: e.name.value.trim(), artist: artistName(e.artist.value), image_path: e.path, folder_id, purchased_on: null,
          ...(wish ? { arrived: false, arrived_at: null, wished_at: now } : { arrived: true, arrived_at: now }) }));
        const { data, error } = await sb.from("cards").insert(rows).select();
        if (error) throw error;
        bdEntries.forEach(keep);
        cards.unshift(...data);
        const f = folderById(folder_id);
        const to = wish ? "à Wishlist" : "ao Binder";
        toast((data.length > 1 ? `${data.length} cards adicionados ${to}` : "Card adicionado " + to) + (f ? ` · pasta ${f.name}.` : "."));
      }
      bdSaving = false; closeBinderForm();
      if (sec !== bdScope) go(bdScope); else render();
    } catch (err) {
      if (uploaded.length) sb.storage.from(BUCKET).remove(uploaded);
      bdError("Não foi possível salvar. Confira a conexão e tente de novo.");
    } finally {
      bdSaving = false;
      $("bdSubmit").disabled = $("bdCancel").disabled = false;
      if (bdlg.open) bdLabels();
      render();
    }
  });

  // ---------- pastas: criar, renomear, capa e excluir ----------
  const fdlg = $("folderDialog");
  let fdEditing = null, fdScope = "binder", fdCover = undefined, fdBlob = null, fdSaving = false;
  function openFolder(f, scope) {
    fdEditing = f; fdScope = f ? f.scope : scope || "binder"; fdCover = f ? f.cover_path : null; fdBlob = null;
    $("fdForm").reset();
    $("fdName").value = f ? f.name : "";
    $("fdTitle").textContent = f ? "Editar pasta" : "Nova pasta";
    $("fdSubmit").textContent = f ? "Salvar pasta" : "Criar pasta";
    $("fdDelete").hidden = !f; $("fdDelConfirm").hidden = true;
    renderCovers();
    if (!fdlg.open) fdlg.showModal();
    $("fdName").focus();
  }
  function folderCards(f) { return cards.filter((c) => c.folder_id === f.id && (f.scope === "wishlist" ? isWish(c) : inBinder(c))); }
  function renderCovers() {
    const f = fdEditing;
    const list = f ? folderCards(f).filter((c) => c.image_path && photoUrls.get(c.image_path)).slice(0, 18) : [];
    $("fdCoverWrap").hidden = !f && !fdBlob;
    const opts = [];
    if (fdBlob) opts.push(["upload", URL.createObjectURL(fdBlob)]);
    else if (fdCover && !list.some((c) => c.image_path === fdCover) && photoUrls.get(fdCover)) opts.push([fdCover, photoUrls.get(fdCover)]);
    list.forEach((c) => opts.push([c.image_path, photoUrls.get(c.image_path)]));
    const cur = fdBlob ? "upload" : fdCover;
    $("fdCovers").replaceChildren(...(opts.length ? opts.map(([key, src]) => el("button", { type: "button", class: "cover-opt" + (key === cur ? " on" : ""), "aria-pressed": String(key === cur),
      onclick: () => { if (key !== "upload") { fdBlob = null; fdCover = key; } renderCovers(); } }, el("img", { src, alt: "" })))
      : [el("p", { class: "hint", text: f ? "Sem fotos nesta pasta ainda. Envie uma imagem ou deixe a capa automática (a foto mais recente)." : "" })]));
  }
  $("fdFile").addEventListener("change", async () => {
    const file = $("fdFile").files && $("fdFile").files[0];
    if (!file) return;
    try { fdBlob = await shrink(file); renderCovers(); } catch (e) { toast("Não deu para ler essa imagem."); }
  });
  function closeFolder() { if (!fdSaving && fdlg.open) fdlg.close(); }
  $("fdClose").addEventListener("click", closeFolder);
  $("fdCancel").addEventListener("click", closeFolder);
  fdlg.addEventListener("click", (e) => { if (e.target === fdlg) closeFolder(); });
  fdlg.addEventListener("cancel", (e) => { if (fdSaving) e.preventDefault(); });
  $("fdForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = $("fdName").value.trim();
    if (!name) return $("fdName").focus();
    fdSaving = true; $("fdSubmit").disabled = true;
    try {
      let cover = fdCover || null;
      if (fdBlob) {
        const path = `${user.id}/pastas/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from(BUCKET).upload(path, fdBlob, { contentType: "image/jpeg" });
        if (error) throw error;
        photoUrls.set(path, URL.createObjectURL(fdBlob));
        cover = path;
      }
      if (fdEditing) {
        const old = fdEditing.cover_path;
        const { data, error } = await sb.from("folders").update({ name, cover_path: cover }).eq("id", fdEditing.id).select().single();
        if (error) throw error;
        Object.assign(fdEditing, data);
        if (old && old !== cover && old.includes("/pastas/")) sb.storage.from(BUCKET).remove([old]);
        toast("Pasta salva.");
      } else {
        const f = await createFolder(name, fdScope);
        if (cover) { await sb.from("folders").update({ cover_path: cover }).eq("id", f.id); f.cover_path = cover; }
        bFolder = f.id;
        toast(`Pasta "${name}" criada. Use Selecionar para colocar cards nela.`);
      }
      fdSaving = false; closeFolder();
    } catch (err) {
      toast("Não foi possível salvar a pasta. Tente de novo.");
    } finally { fdSaving = false; $("fdSubmit").disabled = false; render(); }
  });
  $("fdDelete").addEventListener("click", () => {
    const f = fdEditing; if (!f) return;
    const n = folderCards(f).length;
    $("fdDelConfirm").replaceChildren(
      el("span", { text: `Excluir a pasta "${f.name}"? ${n ? `${plural(n, "O card continua", `Os ${n} cards continuam`)} ${f.scope === "wishlist" ? "na Wishlist" : "no Binder"}, só ${n === 1 ? "fica" : "ficam"} sem pasta.` : "Ela está vazia."}` }),
      el("button", { class: "btn-danger strong", type: "button", text: "Sim, excluir pasta", onclick: () => deleteFolder(f) }),
      el("button", { class: "btn-ghost", type: "button", text: "Cancelar", onclick: () => ($("fdDelConfirm").hidden = true) }));
    $("fdDelConfirm").hidden = false;
  });
  async function deleteFolder(f) {
    fdSaving = true;
    const { error } = await sb.from("folders").delete().eq("id", f.id);
    fdSaving = false;
    if (error) { toast("Não foi possível excluir a pasta."); return; }
    if (f.cover_path && f.cover_path.includes("/pastas/")) sb.storage.from(BUCKET).remove([f.cover_path]);
    cards.forEach((c) => { if (c.folder_id === f.id) c.folder_id = null; });
    folders = folders.filter((x) => x.id !== f.id);
    if (bFolder === f.id) bFolder = "all";
    closeFolder();
    toast(`Pasta excluída. Os cards continuam ${f.scope === "wishlist" ? "na Wishlist" : "no Binder"}.`);
    render();
  }

  // ---------- detalhes de um photocard ----------
  const cdlg = $("cardDialog");
  let cdId = null, cdConfirm = false, cdAcquire = false;
  function openCard(c) { cdId = c.id; cdConfirm = false; cdAcquire = false; refreshCard(); if (!cdlg.open) cdlg.showModal(); }
  function closeCard() { if (cdlg.open) cdlg.close(); }
  cdlg.addEventListener("close", () => { cdId = null; });
  cdlg.addEventListener("click", (e) => { if (e.target === cdlg) closeCard(); });
  $("cdClose").addEventListener("click", closeCard);
  async function moveCards(list, folderId, msg) {
    await patchMany(list, { folder_id: folderId }, msg);
  }
  // da Wishlist direto para o Binder, sem valores (a pasta da Wishlist não vale lá)
  function toBinder(c) {
    patch(c, { kind: "binder", arrived: true, arrived_at: new Date().toISOString(), folder_id: null }, "Foi para o Binder!");
  }
  function refreshCard() {
    const c = cards.find((x) => x.id === cdId);
    if (!c) { closeCard(); return; }
    const src = c.image_path && photoUrls.get(c.image_path);
    const pic = el("div", { class: "cd-pic" }, src ? el("img", { src, alt: c.name }) : el("span", { text: (c.name || "?").charAt(0).toUpperCase() }));
    const rows = [];
    const row = (label, value) => { if (value !== null && value !== undefined && value !== "") rows.push(el("dt", { text: label }), el("dd", {}, value)); };
    row("Grupo de K-pop", c.artist || null);
    const f = folderById(c.folder_id);
    if (isBuy(c)) {
      const g = grp(c);
      row("Vendedor", c.seller);
      row("Data da compra", fmtDate(buyDate(c)));
      row("Categoria", c.gift ? "Presente (sem custo)" : kindLabel(c));
      row("Pedido", g ? g.name : null);
      if (!c.gift) {
        row("Valores", el("div", { class: "money" },
          ...parts(c).flatMap((x) => [el("span", { text: x.label }), el("span", { class: "num", text: money(c[x.key]) })]),
          ...(g ? [el("span", { class: "note", text: "Fretes e taxa no pedido " + g.name })] : [el("span", { class: "tot", text: "Total" }), el("span", { class: "num tot", text: money(total(c)) })])));
        row("Pagamento", "Pago integralmente");
      }
      row("Chegada", c.arrived_at ? "Chegou em " + new Date(c.arrived_at).toLocaleDateString("pt-BR") : "Chegou");
    } else if (!isWish(c)) {
      row("No Binder desde", (c.arrived_at || c.created_at) ? new Date(c.arrived_at || c.created_at).toLocaleDateString("pt-BR") : null);
    }
    if (c.wished_at) row(isWish(c) ? "Na Wishlist desde" : "Esteve na Wishlist desde", new Date(c.wished_at).toLocaleDateString("pt-BR"));

    const move = el("select", { "aria-label": "Mover para a pasta" },
      el("option", { value: "", text: "Sem pasta" }), ...scopeFolders(isWish(c) ? "wishlist" : "binder").map((x) => el("option", { value: x.id, text: x.name })));
    move.value = c.folder_id || "";
    move.addEventListener("change", () => { const to = folderById(move.value); moveCards([c], move.value || null, to ? `Movido para a pasta ${to.name}.` : "Card sem pasta agora."); });

    let actions;
    if (cdAcquire) {
      // "Adquiri este photocard": vira compra (com valores) ou vai direto pro Binder
      actions = el("div", { class: "acquire" },
        el("strong", { text: "Como você conseguiu este card?" }),
        el("button", { class: "acq-opt", type: "button", onclick: () => { closeCard(); startEdit(c); } },
          el("b", { text: "Comprei: registrar como compra" }), el("span", { text: "Abre o cadastro de compra com a foto, o nome e o grupo já preenchidos. Ele entra em Pagamento." })),
        el("button", { class: "acq-opt", type: "button", onclick: () => { closeCard(); toBinder(c); } },
          el("b", { text: "Já está comigo: mover para o Binder" }), el("span", { text: "Sem valores, vai direto para o Binder." })),
        el("button", { class: "btn-ghost", type: "button", text: "Cancelar", onclick: () => { cdAcquire = false; refreshCard(); } }));
    } else if (cdConfirm) {
      actions = el("div", { class: "confirm cd-confirm" },
        el("span", { text: isBuy(c) ? "Este card veio de uma compra. Tirar só do Binder mantém a compra e os valores em Compras › Concluídas." : `Excluir "${c.name}" ${isWish(c) ? "da Wishlist" : "do Binder"}? A foto também é apagada.` }),
        isBuy(c) ? el("button", { class: "btn-ghost", type: "button", text: "Tirar só do Binder", onclick: () => { closeCard(); patch(c, { in_binder: false }, "Tirado do Binder. A compra continua em Concluídas."); } }) : null,
        el("button", { class: "btn-danger strong", type: "button", text: isBuy(c) ? "Excluir card e compra" : "Sim, excluir", onclick: () => { closeCard(); removeCard(c); } }),
        el("button", { class: "btn-ghost", type: "button", text: "Cancelar", onclick: () => { cdConfirm = false; refreshCard(); } }));
    } else {
      actions = el("div", { class: "cd-actions" },
        isWish(c) ? el("button", { class: "btn-primary cd-acq", type: "button", text: "Adquiri este photocard", onclick: () => { cdAcquire = true; refreshCard(); const q = $("cdBody").querySelector(".acquire"); if (q) q.scrollIntoView({ block: "nearest", behavior: "smooth" }); } }) : null,
        el("button", { class: "btn-ghost", type: "button", text: "Editar", onclick: () => { closeCard(); isBuy(c) ? startEdit(c) : openBinderForm(c); } }),
        el("button", { class: "btn-danger", type: "button", text: "Excluir", onclick: () => { cdConfirm = true; refreshCard(); } }));
    }
    $("cdTitle").textContent = c.name;
    $("cdBody").replaceChildren(pic,
      el("div", { class: "cd-info" },
        el("span", { class: "tag" + (isWish(c) ? " tag-wish" : ""), text: isBuy(c) ? (c.gift ? "Presente" : "Compra") : isWish(c) ? "Na Wishlist" : "Cadastrado no Binder" }),
        el("label", { class: "f" }, "Pasta", move),
        rows.length ? el("dl", { class: "cd-list" }, ...rows) : null,
        actions));
  }

  // ---------- tela do Binder ----------
  function folderTile(key, name, count, coverSrc, extra) {
    const on = bFolder === key;
    return el("button", { class: "folder" + (on ? " on" : ""), type: "button", role: "listitem", "aria-pressed": String(on), onclick: () => { bFolder = key; selected.clear(); render(); } },
      el("span", { class: "folder-cover" + (coverSrc ? "" : " empty") }, coverSrc ? el("img", { src: coverSrc, alt: "", loading: "lazy" }) : null),
      el("span", { class: "folder-name", text: name }),
      el("span", { class: "folder-n", text: plural(count, "card", "cards") }), extra || null);
  }
  const coverOf = (f, list) => {
    if (f.cover_path && photoUrls.get(f.cover_path)) return photoUrls.get(f.cover_path);
    const c = list.find((x) => x.image_path && photoUrls.get(x.image_path));
    return c ? photoUrls.get(c.image_path) : null;
  };
  [["bName", "q"]].forEach(([id, k]) => $(id).addEventListener("input", () => { bFilt[k] = $(id).value.trim().toLowerCase(); render(); }));
  $("bArtist").addEventListener("change", () => { bFilt.artist = $("bArtist").value; render(); });
  $("bSelect").addEventListener("click", () => { selecting = !selecting; selected.clear(); render(); });

  function renderBinder() {
    const scope = curScope(), wish = scope === "wishlist", NAME = SCOPE_NAME[scope];
    // trocar entre Binder e Wishlist guarda a pasta aberta de cada um e zera busca e seleção
    if (scope !== bScope) {
      bFolderBy[bScope] = bFolder; bFolder = bFolderBy[scope]; bScope = scope;
      selecting = false; selected.clear(); bFilt.q = ""; bFilt.artist = ""; $("bName").value = ""; $("bArtist").value = "";
    }
    $("hBinder").textContent = NAME;
    $("bAdd").textContent = wish ? "+ Adicionar à Wishlist" : "+ Adicionar ao Binder";
    $("bName").setAttribute("aria-label", `Buscar na ${wish ? "Wishlist" : "coleção"} pelo nome`);
    $("secBinder").classList.toggle("is-wish", wish);
    const all = scopeCards(scope);
    const bf = scopeFolders(scope);
    if (bFolder !== "all" && bFolder !== "none" && !folderById(bFolder)) bFolder = "all";
    // pastas
    const none = all.filter((c) => !c.folder_id || !folderById(c.folder_id));
    const firstPic = (list) => { const c = list.find((x) => x.image_path && photoUrls.get(x.image_path)); return c ? photoUrls.get(c.image_path) : null; };
    $("bFolders").replaceChildren(
      folderTile("all", "Todos", all.length, firstPic(all)),
      ...bf.map((f) => { const l = all.filter((c) => c.folder_id === f.id); return folderTile(f.id, f.name, l.length, coverOf(f, l)); }),
      ...(bf.length && none.length ? [folderTile("none", "Sem pasta", none.length, firstPic(none))] : []),
      el("button", { class: "folder folder-new", type: "button", onclick: () => openFolder(null, scope) },
        el("span", { class: "folder-cover empty" }, el("span", { text: "+" })), el("span", { class: "folder-name", text: "Nova pasta" })));
    const open = folderById(bFolder);
    $("bFolderHead").hidden = !open;
    if (open) $("bFolderHead").replaceChildren(el("h2", { text: open.name }),
      el("button", { class: "btn-ghost btn-sm", type: "button", text: "Editar pasta", onclick: () => openFolder(open) }));

    // filtros
    fillSelect($("bArtist"), "Todos os grupos", distinct(all, "artist", "Sem grupo de K-pop"));
    $("bArtist").hidden = $("bArtist").options.length < 2;
    bFilt.artist = $("bArtist").value;
    $("bFilters").hidden = !all.length;
    $("bSelect").hidden = !all.length;
    $("bSelect").textContent = selecting ? "Cancelar seleção" : "Selecionar";

    // cards antigos sem grupo de K-pop
    const noArtist = all.filter((c) => !c.artist);
    $("bNoArtist").hidden = !noArtist.length || selecting;
    if (noArtist.length) $("bNoArtist").replaceChildren(
      el("span", { text: `${plural(noArtist.length, "card está", "cards estão")} sem grupo de K-pop.` }),
      el("button", { class: "btn-ghost btn-sm", type: "button", text: "Definir grupo", onclick: () => { selecting = true; selected.clear(); noArtist.forEach((c) => selected.add(c.id)); bFilt.artist = "-"; $("bArtist").value = "-"; render(); } }));

    let list = bFolder === "all" ? all : bFolder === "none" ? none : all.filter((c) => c.folder_id === bFolder);
    list = list.filter((c) => (!bFilt.q || c.name.toLowerCase().includes(bFilt.q))
      && (!bFilt.artist || (bFilt.artist === "-" ? !c.artist : (c.artist || "").toLowerCase() === bFilt.artist)));

    const grid = $("bGrid");
    if (loading) grid.replaceChildren(el("div", { class: "empty" }, el("strong", { text: `Carregando ${wish ? "sua Wishlist" : "seu Binder"}…` })));
    else if (!all.length && wish) grid.replaceChildren(el("div", { class: "empty binder-empty" },
      el("div", { class: "cards-deco", "aria-hidden": "true" }, el("span"), el("span"), el("span")),
      el("strong", { text: "Sua Wishlist está vazia" }),
      el("span", { text: "Guarde aqui os cards que você quer ter. Quando conseguir um, ele vira compra ou vai direto para o Binder." }),
      el("div", { class: "form-btns" },
        el("button", { class: "btn-primary", type: "button", text: "+ Adicionar à Wishlist", onclick: () => openBinderForm(null, "wishlist") }))));
    else if (!all.length) grid.replaceChildren(el("div", { class: "empty binder-empty" },
      el("div", { class: "cards-deco", "aria-hidden": "true" }, el("span"), el("span"), el("span")),
      el("strong", { text: "Seu Binder está vazio" }),
      el("span", { text: "Adicione os cards que você já tem, ou registre uma compra: quando ela chegar, o card aparece aqui sozinho." }),
      el("div", { class: "form-btns" },
        el("button", { class: "btn-primary", type: "button", text: "+ Adicionar ao Binder", onclick: () => openBinderForm(null) }),
        el("button", { class: "btn-ghost", type: "button", text: "Registrar uma compra", onclick: () => openNewBuy() }))));
    else if (!list.length) grid.replaceChildren(el("div", { class: "empty" },
      el("strong", { text: open && !bFilt.q && !bFilt.artist ? "Pasta vazia" : "Nenhum card aqui" }),
      el("span", { text: open && !bFilt.q && !bFilt.artist ? "Toque em Selecionar, marque os cards e mova para esta pasta." : "Mude a busca ou o filtro." })));
    else grid.replaceChildren(...list.map((c) => {
      const src = c.image_path && photoUrls.get(c.image_path);
      const on = selected.has(c.id);
      return el("button", { class: "pc" + (on ? " on" : ""), type: "button", "aria-label": c.name, "aria-pressed": selecting ? String(on) : null, title: c.name,
        onclick: () => { if (!selecting) return openCard(c); on ? selected.delete(c.id) : selected.add(c.id); render(); } },
        src ? el("img", { src, alt: "", loading: "lazy" }) : el("span", { class: "pc-ph", text: (c.name || "?").charAt(0).toUpperCase() }),
        selecting ? el("span", { class: "pc-check", "aria-hidden": "true", text: on ? "✓" : "" }) : null);
    }));

    // barra de seleção: mover para pasta e definir grupo
    const bar = $("bSelBar");
    bar.hidden = !selecting;
    if (selecting) {
      const sel = all.filter((c) => selected.has(c.id));
      const to = el("select", { "aria-label": "Mover para a pasta" }, el("option", { value: "", text: "Mover para…" }),
        ...bf.map((f) => el("option", { value: f.id, text: f.name })), el("option", { value: "none", text: "Sem pasta" }), el("option", { value: "new", text: "+ Nova pasta" }));
      to.disabled = !sel.length;
      to.addEventListener("change", async () => {
        let id = to.value;
        if (id === "new") {
          const name = (prompt("Nome da nova pasta") || "").trim();
          if (!name) { to.value = ""; return; }
          try { id = (await createFolder(name, scope)).id; } catch (e) { toast("Não foi possível criar a pasta."); return; }
        }
        const f = folderById(id);
        await moveCards(sel, f ? f.id : null, `${plural(sel.length, "card movido", "cards movidos")} ${f ? "para " + f.name : "para Sem pasta"}.`);
        selecting = false; selected.clear(); render();
      });
      const art = el("input", { type: "text", list: "artistList", placeholder: "Grupo de K-pop", maxlength: "60", "aria-label": "Grupo de K-pop para os selecionados" });
      bar.replaceChildren(
        el("span", { class: "selbar-n", text: plural(sel.length, "selecionado", "selecionados") }),
        to,
        el("div", { class: "selbar-art" }, art, el("button", { class: "btn-ghost btn-sm", type: "button", text: "Definir grupo", disabled: sel.length ? null : "",
          onclick: async () => { const a = artistName(art.value); if (!a) return art.focus(); await patchMany(sel, { artist: a }, `Grupo ${a} definido em ${plural(sel.length, "card", "cards")}.`); selecting = false; selected.clear(); bFilt.artist = ""; render(); } })),
        el("button", { class: "icon-btn", type: "button", text: "Cancelar", onclick: () => { selecting = false; selected.clear(); render(); } }));
    }
  }

  // ---------- render ----------
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) n.append(k);
    return n;
  }
  function thumb(c) {
    const box = el("div", { class: "thumb" });
    const src = c.image_path && photoUrls.get(c.image_path);
    if (src) box.append(el("img", { src, alt: c.name, loading: "lazy" }));
    else box.append(el("span", { text: (c.name || "?").trim().charAt(0).toUpperCase() }));
    return box;
  }
  // pilha com até 3 fotos dos cards do pedido
  function stack(list) {
    const box = el("div", { class: "stack", "aria-hidden": "true" });
    const top = list.slice(0, 3);
    if (!top.length) box.append(el("span"));
    top.forEach((c) => {
      const src = c.image_path && photoUrls.get(c.image_path);
      box.append(el("span", {}, src ? el("img", { src, alt: "", loading: "lazy" }) : null));
    });
    return box;
  }
  function moneyBlock(c) {
    if (c.gift) return null; // presente: a etiqueta "Presente" já diz que não tem custo
    const lines = parts(c).flatMap((x) => [el("span", { text: x.label }), el("span", { class: "num", text: money(c[x.key]) })]);
    if (grp(c)) return el("div", { class: "money" }, ...lines, el("span", { class: "note", text: "Fretes e taxa no pedido" }));
    return el("div", { class: "money" }, ...lines,
      el("span", { class: "tot", text: "Total" }), el("span", { class: "num tot", text: money(total(c)) }));
  }
  function groupMoney(g, m) {
    const lines = [el("span", { text: `Photocards (${m.length})` }), el("span", { class: "num", text: money(sumPrices(m)) })];
    feeParts(g).forEach((x) => lines.push(el("span", { text: x.label }), el("span", { class: "num", text: money(g[x.key]) })));
    return el("div", { class: "money" }, ...lines,
      el("span", { class: "tot", text: "Total do pedido" }), el("span", { class: "num tot", text: money(groupTotal(g)) }));
  }
  function check(label, on, fn) {
    const input = el("input", { type: "checkbox" }); input.checked = !!on;
    input.addEventListener("change", () => fn(input.checked));
    return el("label", { class: "chk" + (on ? " on" : "") }, input, document.createTextNode(label));
  }
  const editButton = (c) => el("button", { class: "icon-btn", type: "button", text: "Editar", "aria-label": "Editar " + c.name, onclick: () => { closeGroups(); startEdit(c); } });
  function deleteControls(c) {
    if (confirmDelete === c.id) {
      return el("div", { class: "actions" },
        el("button", { class: "btn-danger", type: "button", text: "Apagar", onclick: () => { confirmDelete = null; removeCard(c); } }),
        el("button", { class: "icon-btn", type: "button", text: "Cancelar", onclick: () => { confirmDelete = null; render(); } }));
    }
    return el("div", { class: "actions" },
      editButton(c),
      el("button", { class: "icon-btn", type: "button", text: "Excluir", "aria-label": "Excluir " + c.name, onclick: () => { confirmDelete = c.id; render(); } }));
  }
  // dentro do bloco do pedido o card não repete a categoria; solto, mostra o pedido a que pertence
  function infoBlock(c, inGroup) {
    const g = grp(c);
    return el("div", { class: "info" },
      c.artist ? el("span", { class: "artist", text: c.artist }) : null,
      el("span", { class: "title", text: c.name }),
      inGroup ? null : el("span", { class: "tag" + (g ? " tag-group" : ""), text: c.gift ? (g ? "Presente · Pedido: " + g.name : "Presente") : g ? "Pedido: " + g.name : kindLabel(c) }),
      c.seller ? el("span", { class: "from" }, document.createTextNode("Vendedor: "), el("b", { text: c.seller })) : null,
      moneyBlock(c));
  }

  // sugestões do campo "Onde comprou": lojas comuns + vendedores que a pessoa já usou
  const COMMON_SELLERS = ["GOM", "Shopee", "Mercado Livre", "Instagram", "X (Twitter)", "Weverse Shop", "Ktown4u", "AliExpress", "Amazon", "Vinted"];
  // grupos de K-pop: os que a pessoa já usou + alguns comuns; o mesmo nome com outra caixa vira o já usado
  const COMMON_ARTISTS = ["aespa", "Red Velvet", "TWICE", "BLACKPINK", "IVE", "LE SSERAFIM", "NewJeans", "ITZY", "NMIXX", "(G)I-DLE", "STAYC", "BABYMONSTER", "ILLIT", "KISS OF LIFE", "BTS", "Stray Kids", "SEVENTEEN", "ENHYPEN", "TXT", "ATEEZ", "NCT 127", "NCT DREAM", "RIIZE", "ZEROBASEONE"];
  function knownArtists() {
    const seen = new Map();
    cards.forEach((c) => { if (c.artist) seen.set(c.artist.toLowerCase(), c.artist); });
    return seen;
  }
  function artistName(v) {
    const t = (v || "").trim().replace(/\s+/g, " ");
    if (!t) return null;
    const k = t.toLowerCase();
    return knownArtists().get(k) || COMMON_ARTISTS.find((a) => a.toLowerCase() === k) || t;
  }
  function updateArtistList() {
    const seen = knownArtists();
    COMMON_ARTISTS.forEach((a) => { if (!seen.has(a.toLowerCase())) seen.set(a.toLowerCase(), a); });
    $("artistList").replaceChildren(...[...seen.values()].map((v) => el("option", { value: v })));
  }
  function updateSellerList() {
    const seen = new Map();
    cards.forEach((c) => { if (c.seller) seen.set(c.seller.toLowerCase(), c.seller); });
    COMMON_SELLERS.forEach((s) => { if (!seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s); });
    $("sellerList").replaceChildren(...[...seen.values()].map((v) => el("option", { value: v })));
  }

  const rowClass = (inGroup) => "row" + (inGroup ? " sub" : "");
  function rowPay(c, inGroup) {
    const d = due(c);
    const status = el("div", { class: "status" },
      el("div", { class: "checks" },
        ...parts(c).map((x) => check(x.check, c[x.paid], (v) => patch(c, { [x.paid]: v }, v && allPaid({ ...c, [x.paid]: v }) ? "Tudo pago! Foi para Chegada." : null)))),
      d > 0 || !grp(c)
        ? el("span", { class: "pill warn" }, document.createTextNode("Falta pagar "), el("b", { class: "num", text: money(d) }))
        : el("span", { class: "pill warn", text: "Aguardando fretes do pedido" }));
    return el("div", { class: rowClass(inGroup) }, thumb(c), infoBlock(c, inGroup), status, deleteControls(c));
  }
  function rowArr(c, inGroup) {
    // num pedido, "voltar" desmarca só o preço do card (os fretes do pedido valem para todos)
    const undo = grp(c) ? { paid_price: false } : { paid_price: false, paid_shipping: false, paid_shipping_to_gom: false, paid_tax: false };
    const status = el("div", { class: "status" },
      el("span", { class: "pill ok", text: c.gift ? "Presente · sem custo" : "Pago integralmente" }),
      el("div", { class: "checks" },
        el("button", { class: "btn-ok", type: "button", text: "Chegou ✓", onclick: () => patch(c, { arrived: true, arrived_at: new Date().toISOString() }, "Chegou! Já está no Binder.") }),
        c.gift ? null : el("button", { class: "icon-btn", type: "button", text: "Voltar p/ pagamento", onclick: () => patch(c, undo) })));
    return el("div", { class: rowClass(inGroup) }, thumb(c), infoBlock(c, inGroup), status, deleteControls(c));
  }
  function rowCol(c, inGroup) {
    const when = c.arrived_at ? new Date(c.arrived_at).toLocaleDateString("pt-BR") : "";
    const status = el("div", { class: "status" },
      el("span", { class: "pill accent", text: when ? "Chegou em " + when : "Chegou" }),
      c.in_binder === false ? el("button", { class: "icon-btn", type: "button", style: "width:fit-content;padding-left:0", text: "Fora do Binder · pôr de volta", onclick: () => patch(c, { in_binder: true }, "Voltou para o Binder.") }) : null,
      el("button", { class: "icon-btn", type: "button", style: "width:fit-content;padding-left:0", text: "Ainda não chegou", onclick: () => patch(c, { arrived: false, arrived_at: null }) }));
    return el("div", { class: rowClass(inGroup) }, thumb(c), infoBlock(c, inGroup), status, el("div", { class: "actions" }, editButton(c)));
  }

  // cabeçalho do pedido em cada aba: nome, valores compartilhados e o andamento dos cards
  function groupHead(g, here) {
    const m = members(g);
    const info = el("div", { class: "info" },
      el("span", { class: "title", text: g.name }),
      el("span", { class: "tag tag-group", text: "Pedido · " + kindLabel(g) }),
      groupMoney(g, m));
    const status = el("div", { class: "status" });
    const note = (text) => status.append(el("span", { class: "from", text }));
    const countIn = (s) => m.filter((c) => stage(c) === s).length;
    if (tab === "pay") {
      const d = groupDue(g);
      status.append(
        el("div", { class: "checks" }, ...feeParts(g).map((x) => check(x.check, g[x.paid], (v) => patchGroup(g, { [x.paid]: v })))),
        d > 0 ? el("span", { class: "pill warn" }, document.createTextNode("Falta pagar no pedido "), el("b", { class: "num", text: money(d) }))
          : el("span", { class: "pill ok", text: "Pedido pago" }));
      if (!m.length) note("Nenhum card neste pedido ainda. Adicione pelo botão Pedidos.");
      else if (here.length < m.length) note(`${m.length - here.length} de ${m.length} cards já saíram de Pagamento.`);
    } else if (tab === "arr") {
      const arrived = countIn("col"), waiting = countIn("pay");
      // um presente chega a Chegada mesmo com os fretes do pedido em aberto
      status.append(feesPaid(g) ? el("span", { class: "pill ok", text: "Fretes e taxa pagos" })
        : el("span", { class: "pill warn" }, document.createTextNode("Falta pagar no pedido "), el("b", { class: "num", text: money(groupDue(g)) })));
      note(`${arrived} de ${plural(m.length, "card chegou", "cards chegaram")}` + (waiting ? ` · ${waiting} ainda em Pagamento` : ""));
      if (here.length > 1) status.append(el("button", { class: "btn-ok", type: "button", style: "width:fit-content", text: `Todos os ${here.length} chegaram ✓`,
        onclick: () => patchMany(here, { arrived: true, arrived_at: new Date().toISOString() }, `${here.length} cards chegaram! Já estão no Binder.`) }));
    } else {
      status.append(el("span", { class: "pill accent", text: `${here.length} de ${m.length} chegaram` }));
    }
    // clicar no pedido abre a janela do pedido com os cards dele
    const open = () => openGroupDetail(g, false);
    const head = el("div", { class: "row ghead clickable", role: "button", tabindex: "0", "aria-haspopup": "dialog", "aria-label": "Abrir o pedido " + g.name },
      stack(m), info, status, el("div", { class: "actions" }, el("span", { class: "gopen", "aria-hidden": "true", text: "›" })));
    head.addEventListener("click", (e) => { if (!e.target.closest("button, label, input, a")) open(); });
    head.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === head) { e.preventDefault(); open(); } });
    return head;
  }

  const HEAD = { pay: "Pagamento", arr: "Chegada", col: "Status" };
  const EMPTY = {
    pay: ["Nada pendente de pagamento", "Use \"+ Registrar compra\". A compra fica aqui até o preço, os fretes e as taxas estarem pagos."],
    arr: ["Nenhum card a caminho", "Quando tudo estiver pago, o card vem para cá esperando chegar."],
    col: ["Nenhuma compra concluída ainda", "As compras marcadas como \"Chegou\" ficam guardadas aqui."],
  };
  function plural(n, s, p) { return `${n} ${n === 1 ? s : p}`; }
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const fmtDate = (iso) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString("pt-BR") : "");
  const buyDate = (c) => c.purchased_on || (c.created_at || "").slice(0, 10);

  // ---------- números do resumo (Início e Financeiro): só compras ----------
  function sums() {
    const list = buys();
    const byStage = { pay: [], arr: [], col: [] };
    list.forEach((c) => byStage[stage(c)].push(c));
    // fretes e taxas de pedido entram uma vez só
    const live = list.reduce((s, c) => s + total(c), 0) + groups.reduce((s, g) => s + fees(g), 0);
    const all = cents(live + archived.total);
    const dueSum = cents(list.reduce((s, c) => s + due(c), 0) + groups.reduce((s, g) => s + feesDue(g), 0));
    return { list, byStage, all, dueSum, paid: cents(all - dueSum), n: list.length + archived.count };
  }

  // ---------- seções ----------
  function go(s, t) {
    if (t) { tab = t; confirmDelete = null; try { localStorage.setItem("pc-tab", t); } catch (e) {} }
    if (location.hash.slice(1) !== s) location.hash = s; // o hashchange desenha
    else { sec = s; render(); }
  }
  window.addEventListener("hashchange", () => {
    const s = location.hash.slice(1);
    if (!SECS.includes(s)) return;
    sec = s; setFab(false); render();
    window.scrollTo(0, 0);
  });
  function renderNav(sm) {
    document.querySelectorAll(".navlinks a").forEach((a) => {
      if (a.dataset.sec === sec) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    $("secInicio").hidden = sec !== "inicio";
    $("secCompras").hidden = sec !== "compras";
    $("secFinanceiro").hidden = sec !== "financeiro";
    $("secBinder").hidden = sec !== "binder" && sec !== "wishlist";
    const pend = sm.byStage.pay.length + sm.byStage.arr.length;
    $("nPend").hidden = !pend;
    $("nPend").textContent = pend;
    $("nPend").setAttribute("aria-label", plural(pend, "compra pendente", "compras pendentes"));
  }

  // linha compacta do Início: foto, nome, detalhe e uma ação
  function mini(c, sub, action) {
    return el("div", { class: "mini" }, thumb(c),
      el("div", { class: "info" },
        el("span", { class: "title", text: c.name }),
        el("span", { class: "from", text: sub })),
      action || null);
  }
  const box = (title, link, ...kids) => el("section", { class: "box" },
    el("div", { class: "box-head" }, el("h2", { text: title }), link || null), ...kids);
  const linkBtn = (text, s, t) => el("button", { class: "linkbtn", type: "button", text, onclick: () => go(s, t) });

  function renderInicio(sm) {
    const home = $("home");
    if (loading) { home.replaceChildren(el("div", { class: "empty" }, el("strong", { text: "Carregando…" }))); return; }
    if (!cards.length && !archived.count) {
      home.replaceChildren(el("div", { class: "box empty welcome" },
        el("div", { class: "cards-deco", "aria-hidden": "true" }, el("span"), el("span"), el("span")),
        el("strong", { text: "Comece pela sua primeira compra ou pelo Binder" }),
        el("span", { text: "Registre uma compra para acompanhar pagamento e chegada, ou adicione ao Binder os cards que você já tem." }),
        el("div", { class: "form-btns" },
          el("button", { class: "btn-primary", type: "button", text: "+ Registrar compra", onclick: () => openNewBuy() }),
          el("button", { class: "btn-ghost", type: "button", text: "Adicionar ao Binder", onclick: () => openBinderForm(null) }))));
      return;
    }
    const { pay, arr } = sm.byStage;
    const bc = binderCards();
    const wc = wishCards();
    const payDue = sm.dueSum;
    const withDate = arr.filter((c) => c.expected_on).sort((a, b) => a.expected_on.localeCompare(b.expected_on));
    const next = withDate[0];

    // 1) precisa de atenção
    const tiles = el("div", { class: "tiles" },
      el("button", { class: "tile" + (pay.length ? " warn" : ""), type: "button", onclick: () => go("compras", "pay") },
        el("span", { class: "label", text: "Aguardando pagamento" }),
        el("span", { class: "value num", text: pay.length }),
        el("span", { class: "sub", text: payDue > 0 ? "faltam " + money(payDue) : "nada a pagar" })),
      el("button", { class: "tile" + (arr.length ? " info-t" : ""), type: "button", onclick: () => go("compras", "arr") },
        el("span", { class: "label", text: "A caminho" }),
        el("span", { class: "value num", text: arr.length }),
        el("span", { class: "sub", text: next ? "próxima prevista para " + fmtDate(next.expected_on) : arr.length ? "sem previsão de chegada" : "nenhum card a caminho" })),
      el("button", { class: "tile tile-binder", type: "button", onclick: () => go("binder") },
        el("span", { class: "label", text: "No Binder" }),
        el("span", { class: "value num", text: bc.length }),
        el("span", { class: "sub", text: plural(new Set(bc.filter((c) => c.artist).map((c) => c.artist.toLowerCase())).size, "grupo", "grupos") + " · " + plural(scopeFolders("binder").length, "pasta", "pastas") })),
      el("button", { class: "tile tile-wish", type: "button", onclick: () => go("wishlist") },
        el("span", { class: "label", text: "Na Wishlist" }),
        el("span", { class: "value num", text: wc.length }),
        el("span", { class: "sub", text: wc.length ? "último: " + wc[0].name : "nenhum card desejado" })));

    // 2) pagamentos pendentes: cards com valor em aberto e pedidos com frete ou taxa em aberto
    const payItems = [
      ...groups.filter((g) => feesDue(g) > 0).map((g) => ({ when: (g.created_at || "").slice(0, 10), node: el("div", { class: "mini" }, stack(members(g)),
        el("div", { class: "info" }, el("span", { class: "title", text: g.name }), el("span", { class: "from", text: "Fretes e taxa do pedido · falta " + money(feesDue(g)) })),
        el("button", { class: "btn-ghost btn-sm", type: "button", text: "Marcar pago", onclick: () => patchGroup(g, Object.fromEntries(feeParts(g).map((x) => [x.paid, true]))) })) })),
      ...pay.filter((c) => due(c) > 0).map((c) => ({ when: buyDate(c), node: mini(c, (c.artist ? c.artist + " · " : "") + "falta " + money(due(c)),
        el("button", { class: "btn-ghost btn-sm", type: "button", text: "Marcar pago", "aria-label": "Marcar tudo pago: " + c.name,
          onclick: () => { const ch = Object.fromEntries(parts(c).map((x) => [x.paid, true])); patch(c, ch, allPaid({ ...c, ...ch }) ? "Tudo pago! Foi para Chegada." : "Pago. Faltam os fretes do pedido."); } })) })),
    ].sort((a, b) => a.when.localeCompare(b.when));

    // 3) próximas chegadas (com previsão primeiro)
    const arrList = [...withDate, ...arr.filter((c) => !c.expected_on)].slice(0, 5);
    // 4) compras recentes
    const recent = [...sm.list].sort((a, b) => buyDate(b).localeCompare(buyDate(a)) || (b.created_at || "").localeCompare(a.created_at || "")).slice(0, 5);
    const STAGE_PILL = { pay: ["warn", "Pagamento"], arr: ["ok", "A caminho"], col: ["accent", "Chegou"] };
    // 5) últimos que chegaram
    const lastIn = bc.slice(0, 8);

    home.replaceChildren(
      tiles,
      el("div", { class: "home-grid" },
        box("Pagamentos pendentes", pay.length ? linkBtn("Ver todos", "compras", "pay") : null,
          payItems.length ? el("div", { class: "minis" }, ...payItems.slice(0, 5).map((x) => x.node))
            : el("p", { class: "box-empty", text: "Tudo pago por enquanto." })),
        box("Próximas chegadas", arr.length ? linkBtn("Ver todas", "compras", "arr") : null,
          arrList.length ? el("div", { class: "minis" }, ...arrList.map((c) => mini(c, c.expected_on ? "previsão: " + fmtDate(c.expected_on) : "sem previsão",
            el("button", { class: "btn-ok btn-sm", type: "button", text: "Chegou ✓", "aria-label": "Chegou: " + c.name,
              onclick: () => patch(c, { arrived: true, arrived_at: new Date().toISOString() }, "Chegou! Já está no Binder.") }))))
            : el("p", { class: "box-empty", text: "Nenhum card a caminho." })),
        box("Compras recentes", linkBtn("Ver compras", "compras"),
          el("div", { class: "minis" }, ...recent.map((c) => {
            const [k, t] = STAGE_PILL[stage(c)];
            return mini(c, fmtDate(buyDate(c)) + " · " + (c.gift ? "Presente" : money(total(c))), el("span", { class: "pill " + k, text: t }));
          }))),
        box("Últimos no Binder", bc.length ? linkBtn("Abrir o Binder", "binder") : null,
          lastIn.length ? el("div", { class: "strip" }, ...lastIn.map((c) => el("button", { class: "strip-item", type: "button", "aria-label": c.name, title: c.name, onclick: () => openCard(c) }, thumb(c))))
            : el("p", { class: "box-empty", text: "Quando uma compra chegar ou você adicionar um card ao Binder, a foto aparece aqui." }))));
  }

  // ---------- Compras ----------
  const KIND_FILTERS = [["individual-nacional", "Individual Nacional"], ["individual-internacional", "Individual Internacional"], ["ceg-nacional", "CEG Nacional"], ["ceg-internacional", "CEG Internacional"], ["gift", "Presente"]];
  const kindKey = (c) => (c.purchase_type || "individual") + "-" + (c.origin || "nacional");
  const filtering = () => !!(filt.q || filt.artist || filt.seller || filt.kind);
  const matches = (c) => (!filt.q || c.name.toLowerCase().includes(filt.q))
    && (!filt.artist || (filt.artist === "-" ? !c.artist : (c.artist || "").toLowerCase() === filt.artist))
    && (!filt.seller || (filt.seller === "-" ? !c.seller : (c.seller || "").toLowerCase() === filt.seller))
    && (!filt.kind || (filt.kind === "gift" ? c.gift : !c.gift && kindKey(c) === filt.kind));
  function fillSelect(sel, all, opts) {
    const cur = sel.value;
    sel.replaceChildren(el("option", { value: "", text: all }), ...opts.map(([v, t]) => el("option", { value: v, text: t })));
    sel.value = opts.some(([v]) => v === cur) ? cur : "";
  }
  function distinct(list, key, none) {
    const m = new Map();
    let empty = false;
    list.forEach((c) => { const v = (c[key] || "").trim(); if (v) { if (!m.has(v.toLowerCase())) m.set(v.toLowerCase(), v); } else empty = true; });
    const opts = [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")).map(([k, v]) => [k, v]);
    if (empty && opts.length) opts.push(["-", none]);
    return opts;
  }
  function renderFilters(list) {
    fillSelect($("qArtist"), "Todos os grupos", distinct(list, "artist", "Sem grupo de K-pop"));
    fillSelect($("qSeller"), "Todos os vendedores", distinct(list, "seller", "Sem vendedor"));
    fillSelect($("qKind"), "Todas as categorias", KIND_FILTERS);
    $("qArtist").hidden = $("qArtist").options.length < 2;
    $("qSeller").hidden = $("qSeller").options.length < 2;
    filt.artist = $("qArtist").value; filt.seller = $("qSeller").value;
    $("qClear").hidden = !filtering();
    $("filters").hidden = !list.length;
  }
  [["qArtist", "artist"], ["qSeller", "seller"], ["qKind", "kind"]].forEach(([id, k]) => $(id).addEventListener("change", () => { filt[k] = $(id).value; render(); }));
  $("qName").addEventListener("input", () => { filt.q = $("qName").value.trim().toLowerCase(); render(); });
  $("qClear").addEventListener("click", () => {
    Object.assign(filt, { q: "", artist: "", seller: "", kind: "" });
    $("qName").value = ""; $("qArtist").value = ""; $("qSeller").value = ""; $("qKind").value = "";
    render();
  });

  function renderCompras(sm) {
    renderFilters(sm.list);
    const on = filtering();
    const byStage = on ? { pay: sm.byStage.pay.filter(matches), arr: sm.byStage.arr.filter(matches), col: sm.byStage.col.filter(matches) } : sm.byStage;
    $("cPay").textContent = byStage.pay.length; $("cArr").textContent = byStage.arr.length; $("cCol").textContent = byStage.col.length;
    document.querySelectorAll("#mainTabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));

    const panel = $("panel"); panel.replaceChildren();
    const list = byStage[tab];

    // monta a lista: cards soltos e blocos de pedido, na ordem do card mais recente
    const grouped = tab !== "col" || colView === "groups";
    const items = [], blocks = new Map();
    list.forEach((c) => {
      const g = grouped && grp(c);
      if (!g) { items.push({ card: c }); return; }
      let it = blocks.get(g.id);
      if (!it) { it = { g, cards: [] }; blocks.set(g.id, it); items.push(it); }
      it.cards.push(c);
    });
    // em Pagamento, pedidos com frete ou taxa em aberto aparecem mesmo sem cards aqui
    if (tab === "pay" && !on) groups.filter((g) => !blocks.has(g.id) && !feesPaid(g)).reverse().forEach((g) => items.unshift({ g, cards: [] }));

    if (tab === "col") {
      // pedido com todos os cards concluídos: os fretes e a taxa entram no valor
      const full = groups.filter((g) => { const m = members(g); return m.length && m.every((c) => stage(c) === "col"); });
      const colTotal = list.reduce((s, c) => s + total(c), 0) + (on ? 0 : full.reduce((s, g) => s + fees(g), 0));
      const viewSeg = groups.length ? el("div", { class: "seg", role: "radiogroup", "aria-label": "Ver as compras concluídas" },
        ...[["cards", "Cards"], ["groups", "Por pedido"]].map(([v, label]) => {
          const r = el("input", { type: "radio", name: "colView", value: v });
          r.checked = colView === v;
          r.addEventListener("change", () => setColView(v));
          return el("label", {}, r, el("span", { text: label }));
        })) : null;
      panel.append(el("div", { class: "panel-head" },
        el("p", {}, document.createTextNode(plural(list.length, "card", "cards") + " · "), el("span", { class: "num", text: money(colTotal) })),
        el("div", { class: "panel-tools" }, viewSeg)));
    }

    const table = el("div", { class: "table" });
    if (loading) {
      table.append(el("div", { class: "empty" }, el("strong", { text: "Carregando suas compras…" })));
    } else if (!items.length) {
      const [t, s] = on ? ["Nenhuma compra com esses filtros", "Mude a busca ou use \"Limpar filtros\"."] : EMPTY[tab];
      table.append(el("div", { class: "empty" }, el("strong", { text: t }), el("span", { text: s })));
    } else {
      table.append(el("div", { class: "thead" }, el("span", { text: "Foto" }), el("span", { text: "Card · Valores" }), el("span", { text: HEAD[tab] }), el("span", {})));
      const fn = tab === "pay" ? rowPay : tab === "arr" ? rowArr : rowCol;
      items.forEach((it) => table.append(it.g
        ? el("div", { class: "group" }, groupHead(it.g, it.cards))
        : fn(it.card, false)));
    }
    panel.append(table);
  }

  // ---------- Financeiro ----------
  // barras horizontais; fmt muda o número da direita (dinheiro por padrão)
  function bars(rows, note, fmt = money, empty = "Nada para mostrar ainda.") {
    if (!rows.length) return el("p", { class: "box-empty", text: empty });
    const max = Math.max(...rows.map((r) => r[1])) || 1;
    return el("div", { class: "bars" }, ...rows.map(([label, v, sub]) => el("div", { class: "bar-row", title: `${label}: ${fmt(v)}${sub ? " · " + sub : ""}` },
      el("span", { class: "bar-label" }, document.createTextNode(label), sub ? el("small", { text: sub }) : null),
      el("span", { class: "bar-track", "aria-hidden": "true" }, el("span", { class: "bar-fill", style: `width:${Math.max(2, (v / max) * 100).toFixed(1)}%` })),
      el("span", { class: "bar-val num", text: fmt(v) }))),
      note ? el("p", { class: "hint", text: note }) : null);
  }
  const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  // colunas dos últimos 12 meses (meses sem compra aparecem zerados); o valor aparece no maior e no mês atual,
  // os outros ao passar o dedo ou o mouse
  function monthColumns(months) {
    const now = new Date();
    const keys = [];
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }
    const vals = keys.map((k) => months.get(k) || 0);
    if (!vals.some((v) => v > 0)) return el("p", { class: "box-empty", text: "Nenhuma compra nos últimos 12 meses." });
    const max = Math.max(...vals);
    const iMax = vals.indexOf(max), iNow = keys.length - 1;
    const sel = el("p", { class: "cols-sel", "aria-live": "polite" });
    const show = (i) => { sel.textContent = `${MES[Number(keys[i].slice(5, 7)) - 1]} ${keys[i].slice(0, 4)}: ${money(vals[i])}`; };
    const cols = el("div", { class: "cols", role: "list" }, ...keys.map((k, i) => {
      const lab = `${MES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}: ${money(vals[i])}`;
      return el("button", { class: "col" + (i === iNow ? " now" : ""), type: "button", role: "listitem", title: lab, "aria-label": lab,
        onmouseenter: () => show(i), onfocus: () => show(i), onclick: () => show(i) },
        el("span", { class: "col-val num", text: (i === iMax || i === iNow) && vals[i] > 0 ? moneyShort(vals[i]) : "" }),
        el("span", { class: "col-bar", style: `height:${vals[i] > 0 ? Math.max(3, (vals[i] / max) * 100).toFixed(1) : 0}%` }),
        el("span", { class: "col-lab" }, MES[Number(k.slice(5, 7)) - 1], k.endsWith("-01") || i === 0 ? el("small", { class: "col-y", text: " " + k.slice(2, 4) }) : null));
    }));
    show(iNow);
    return el("div", {}, cols, sel);
  }
  const moneyShort = (v) => (v >= 1000 ? "R$ " + (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil" : "R$ " + Math.round(v).toLocaleString("pt-BR"));
  // de onde vem o dinheiro: uma barra dividida em photocards, fretes e taxas
  function splitBar(parts) {
    const tot = parts.reduce((s, p) => s + p[1], 0);
    if (tot <= 0) return null;
    const pct = (v) => Math.round((v / tot) * 100) + "%";
    return el("section", { class: "box split" },
      el("div", { class: "box-head" }, el("h2", { text: "Para onde vai o dinheiro" })),
      el("div", { class: "split-bar", role: "img", "aria-label": parts.map(([l, v]) => `${l} ${pct(v)}`).join(", ") },
        ...parts.filter((p) => p[1] > 0).map(([l, v], i) => el("span", { class: "sp sp-" + parts.findIndex((x) => x[0] === l), style: `flex-grow:${v}`, title: `${l}: ${money(v)} (${pct(v)})` }))),
      el("div", { class: "split-legend" }, ...parts.map(([l, v], i) => el("span", { class: "leg" },
        el("i", { class: "sp-" + i, "aria-hidden": "true" }), el("b", { text: l }), el("span", { class: "num", text: `${money(v)} · ${pct(v)}` })))));
  }
  function sumBy(list, keyFn) {
    const m = new Map();
    list.forEach((c) => { const k = keyFn(c); const cur = m.get(k) || [k, 0, 0]; cur[1] = cents(cur[1] + total(c)); cur[2]++; m.set(k, cur); });
    return [...m.values()].filter((r) => r[1] > 0).sort((a, b) => b[1] - a[1]).map(([k, v, n]) => [k, v, plural(n, "card", "cards")]);
  }
  const cardsN = (n) => plural(n, "card", "cards");
  // quantos cards por grupo de K-pop (Binder e Wishlist não têm valores)
  function countBy(list) {
    const m = new Map();
    list.forEach((c) => { const k = c.artist || "Sem grupo de K-pop"; const key = k.toLowerCase(); const cur = m.get(key) || [k, 0]; cur[1]++; m.set(key, cur); });
    return [...m.values()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
  }
  function renderFin(sm) {
    const fin = $("fin");
    if (loading) { fin.replaceChildren(el("div", { class: "empty" }, el("strong", { text: "Carregando…" }))); return; }
    const list = sm.list;
    // de onde vem o total: preço dos cards, fretes e taxas (cards sem pedido + pedidos)
    let price = 0, ship = 0, tax = 0;
    list.forEach((c) => { price += Number(c.price) || 0; });
    [...list.filter((c) => !grp(c)), ...groups].forEach((src) => feeParts(src).forEach((x) => {
      const v = Number(src[x.key]) || 0;
      if (x.key === "import_tax") tax += v; else ship += v;
    }));
    const groupFees = cents(groups.reduce((s, g) => s + fees(g), 0));
    const kpi = (label, value, sub, cls) => el("div", { class: "kpi" + (cls ? " " + cls : "") },
      el("span", { class: "label", text: label }), el("span", { class: "value num", text: money(value) }), sub ? el("span", { class: "sub", text: sub }) : null);

    // por categoria: cards e pedidos pelo tipo e origem
    const cat = new Map(KIND_FILTERS.map(([k, t]) => [k, [t, 0, 0]]));
    list.forEach((c) => { const r = cat.get(c.gift ? "gift" : kindKey(c)); r[1] += total(c); r[2]++; });
    groups.forEach((g) => { cat.get(kindKey(g))[1] += fees(g); });
    const catRows = [...cat.values()].filter((r) => r[0] !== "Presente" && r[1] > 0).sort((a, b) => b[1] - a[1]).map(([t, v, n]) => [t, cents(v), plural(n, "card", "cards")]);
    const gifts = list.filter((c) => c.gift).length;

    // por mês, pela data da compra; fretes de pedido pela data do pedido
    const months = new Map();
    const addMonth = (iso, v) => { const k = (iso || "").slice(0, 7); if (!k) return; months.set(k, cents((months.get(k) || 0) + v)); };
    list.forEach((c) => addMonth(buyDate(c), total(c)));
    groups.forEach((g) => addMonth((g.created_at || "").slice(0, 10), fees(g)));
    const monthRows = [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12)
      .map(([k, v]) => [`${MES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`, v]);
    const feeNote = groupFees > 0 ? `Fretes e taxas de pedidos (${money(groupFees)}) não entram aqui, porque valem para vários cards.` : null;

    fin.replaceChildren(
      el("div", { class: "kpis" },
        kpi("Total investido", sm.all, plural(sm.n, "card", "cards") + (archived.count ? ` · inclui ${money(archived.total)} de coleções apagadas` : ""), "big"),
        kpi("Já pago", sm.paid, plural(sm.byStage.arr.length + sm.byStage.col.length, "compra quitada", "compras quitadas"), "ok"),
        kpi("Falta pagar", sm.dueSum, plural(sm.byStage.pay.length, "compra em aberto", "compras em aberto"), sm.dueSum > 0 ? "warn" : ""),
        kpi("Em photocards", cents(price), "preço dos cards"),
        kpi("Em fretes", cents(ship), "até a GOM e até você"),
        kpi("Em taxas", cents(tax), "taxa de importação")),
      splitBar([["Photocards", cents(price)], ["Fretes", cents(ship)], ["Taxas", cents(tax)]]),
      box("Gasto nos últimos 12 meses", null, monthColumns(months),
        el("p", { class: "hint", text: "Pela data da compra. Fretes de pedido entram no mês em que o pedido foi criado." })),
      el("div", { class: "home-grid" },
        box("Por mês", null, bars(monthRows, null)),
        box("Por categoria", null, bars(catRows, gifts ? plural(gifts, "presente sem custo", "presentes sem custo") + " fora da conta." : null)),
        box("Por grupo de K-pop", null, bars(sumBy(list, (c) => c.artist || "Sem grupo de K-pop"), feeNote)),
        box("Por vendedor", null, bars(sumBy(list, (c) => c.seller || "Sem vendedor"), feeNote)),
        box("Coleção por grupo", linkBtn("Abrir o Binder", "binder"), bars(countBy(binderCards()), null, cardsN, "O Binder ainda está vazio.")),
        box("Wishlist por grupo", linkBtn("Abrir a Wishlist", "wishlist"), bars(countBy(wishCards()), null, cardsN, "A Wishlist está vazia."))),
      sm.dueSum > 0 ? el("div", { class: "fin-foot" },
        el("span", { text: `Falta pagar ${money(sm.dueSum)}.` }),
        el("button", { class: "btn-primary", type: "button", text: "Ver pagamentos pendentes", onclick: () => go("compras", "pay") })) : null);
  }

  function render() {
    updateSellerList();
    updateArtistList();
    const sm = sums();
    $("sTotal").textContent = money(sm.all);
    $("sTotalSub").textContent = plural(sm.n, "card", "cards") + (archived.count ? ` · inclui ${archived.count} de coleções apagadas` : " · preço, fretes e taxas");
    $("sPaid").textContent = money(sm.paid);
    $("sPaidSub").textContent = plural(sm.byStage.arr.length + sm.byStage.col.length, "quitado", "quitados");
    $("sDue").textContent = money(sm.dueSum);
    $("sDueSub").textContent = `${sm.byStage.pay.length} em aberto`;
    if (gdlg.open && !$("gListView").hidden) renderGroupList();
    if (gdlg.open && gDetailId && !$("gDetailView").hidden) {
      const g = groupsById.get(gDetailId);
      if (g) showGroupDetail(g); else showGroupList();
    }
    renderNav(sm);
    if (sec === "inicio") renderInicio(sm);
    else if (sec === "compras") renderCompras(sm);
    else if (sec === "binder" || sec === "wishlist") renderBinder();
    else renderFin(sm);
    if (cdlg.open) refreshCard();
    setFab(!$("fabMenu").hidden);
  }

  setMode("login");
  resetForm();
  sb.auth.getSession().then(({ data }) => { if (!data.session) show("authView"); });
})();
