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
  let groups = []; // grupos de cards da mesma compra
  let groupsById = new Map();
  let archived = { total: 0, count: 0 };
  let photoUrls = new Map(); // image_path -> signed url
  let tab = "pay";
  try { const t = localStorage.getItem("pc-tab"); if (["pay", "arr", "col"].includes(t)) tab = t; } catch (e) {}
  let colView = "cards"; // Coleção: "cards" (um por um) ou "groups" (por grupo)
  try { if (localStorage.getItem("pc-colview") === "groups") colView = "groups"; } catch (e) {}
  let loading = true, confirmClear = false, confirmDelete = null, clearing = false;
  let editing = null, saving = false; // card em edição no formulário
  const busy = new Set();
  let gDetailId = null; // grupo aberto na janela do grupo

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

  // ---------- grupos ----------
  // Num card com grupo valem só o preço e o "preço pago" do card. Os fretes e a taxa ficam no
  // grupo e contam uma vez só. Os fretes próprios do card ficam guardados e voltam a contar se
  // ele sair do grupo.
  const grp = (c) => (c.group_id && groupsById.get(c.group_id)) || null;
  const members = (g) => cards.filter((c) => c.group_id === g.id);
  function setGroups(list) {
    groups = list;
    groupsById = new Map(groups.map((g) => [g.id, g]));
  }
  const addGroupLocal = (g) => setGroups([g, ...groups.filter((x) => x.id !== g.id)]);

  // fretes e taxa de um card sem grupo ou de um grupo, cada um com o seu "pago"
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

  // partes que o card paga sozinho: o preço e, se não tiver grupo, os próprios fretes e taxa
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
      const [{ data: rows, error: e1 }, { data: st, error: e2 }, { data: gs, error: e3 }] = await Promise.all([
        sb.from("cards").select("*").order("created_at", { ascending: false }).order("name"),
        sb.from("stats").select("*").maybeSingle(),
        sb.from("card_groups").select("*").order("created_at", { ascending: false }),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      if (e3) throw e3;
      cards = rows || [];
      setGroups(gs || []);
      archived = { total: Number(st?.archived_total) || 0, count: Number(st?.archived_count) || 0 };
      await signPhotos();
      notice("");
    } catch (err) {
      notice("Não consegui carregar seus cards. Confira se rodou o arquivo supabase/schema.sql no Supabase e recarregue a página.");
    } finally { loading = false; render(); }
  }

  async function signPhotos() {
    const need = cards.map((c) => c.image_path).filter((p) => p && !photoUrls.has(p));
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

  // campos de frete e taxa (usados no card sem grupo e no grupo); campos escondidos contam como zero
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
      const s = Math.min(1, 360 / img.width, 560 / img.height);
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      return await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.82));
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------- cadastro de um ou mais photocards ----------
  // Cada card tem foto, nome, vendedor e preço próprios. O tipo e a origem valem para todos.
  // Com grupo, os fretes e a taxa ficam no grupo; sem grupo, cada card tem os seus.
  let entries = [];
  let groupTouched = false; // a pessoa mexeu na escolha de grupo
  const fGroupFees = feeInputs(updateFormTotal);
  $("fGroupFeeFields").append(...fGroupFees.nodes);

  function makeEntry() {
    const e = { photoBlob: null, previewUrl: null, path: null };
    e.name = el("input", { type: "text", placeholder: "ex.: Jisoo · Born Pink · POB Weverse", required: "", maxlength: "120" });
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
    $("entries").append(e.node);
    // dois ou mais cards: sugere juntar num grupo novo, levando os fretes já digitados
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

  // tipo e origem do que está sendo cadastrado (num grupo existente, vêm do grupo)
  function formKind() {
    const mode = $("fGroup").value;
    const g = mode && mode !== "new" ? groupsById.get(mode) : null;
    return { mode, g, gift: $("fGift").checked, t: g ? g.purchase_type : radio("fType") || "individual", o: g ? g.origin : radio("fOrigin") || "nacional" };
  }
  function updateKindFields() {
    const { mode, g, gift, t, o } = formKind();
    $("fTypeWrap").hidden = $("fOriginWrap").hidden = !!g || gift;
    $("fHint").textContent = gift ? "Presente: o card não tem custo nenhum e vai direto para a aba Chegada." : g ? "" : HINT[t + "-" + o];
    $("fGroupRow").hidden = gift;
    $("fGroupNameWrap").hidden = mode !== "new";
    $("fGroupName").required = mode === "new";
    $("fGroupFees").hidden = mode !== "new";
    fGroupFees.show(t, o);
    entries.forEach((e, i) => {
      e.fees.show(t, o, !mode && !gift);
      e.priceWrap.hidden = gift;
      e.price.required = !gift;
      e.num.textContent = "Photocard " + (i + 1);
      e.head.hidden = entries.length === 1;
    });
    $("addEntry").hidden = !!editing;
    let hint = "";
    if (g) hint = `${kindLabel(g)}. Os fretes e a taxa já estão no grupo "${g.name}": aqui vai só o preço de cada card.`;
    else if (mode === "new") hint = "Cada card guarda nome, vendedor, preço e foto. Os fretes e a taxa ficam no grupo.";
    else if (entries.length > 1) hint = "Sem grupo, cada card tem os próprios fretes.";
    if (editing && mode && !editing.group_id && fees(editing) > 0)
      hint += ` Os fretes que estavam neste card (${money(fees(editing))}) ficam guardados, mas deixam de contar enquanto ele estiver no grupo.`;
    $("fGroupHint").textContent = hint;
    formLabels();
    updateFormTotal();
  }
  function updateFormTotal() {
    const { mode, gift, t, o } = formKind();
    let sum = gift ? 0 : entries.reduce((s, e) => s + cents(e.price.value) + (mode ? 0 : e.fees.sum(t, o)), 0);
    if (mode === "new") sum += fGroupFees.sum(t, o);
    $("fTotal").textContent = money(sum);
    $("fTotalLabel").textContent = mode === "new" ? "Total do grupo" : mode ? (entries.length > 1 ? "Preço dos cards" : "Preço do card") : "Total";
  }
  document.querySelectorAll("input[name=fType], input[name=fOrigin]").forEach((r) => r.addEventListener("change", updateKindFields));
  $("fGift").addEventListener("change", () => { if ($("fGift").checked) $("fGroup").value = ""; updateKindFields(); });

  function formLabels() {
    const n = entries.length;
    $("fSubmit").textContent = editing ? "Salvar alterações" : n > 1 ? `Cadastrar ${n} photocards` : "Cadastrar photocard";
    const aba = $("fGift").checked ? "Chegada" : "Pagamento";
    $("formMsg").textContent = editing ? "Editando: " + editing.name : n > 1 ? `Os cards entram na aba ${aba}.` : `O card entra na aba ${aba}.`;
    $("addTitle").textContent = editing ? "Editar photocard" : n > 1 ? "Cadastrar photocards" : "Cadastrar photocard";
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
    updateKindFields();
    if (!dlg.open) dlg.showModal();
    entries[0].name.focus();
  }
  // fechar mantém o rascunho de cards novos; uma edição é descartada
  function closeForm() {
    if (saving) return;
    if (dlg.open) dlg.close();
  }
  dlg.addEventListener("close", () => { if (editing) resetForm(); });
  dlg.addEventListener("cancel", (e) => { if (saving) e.preventDefault(); }); // tecla Esc
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeForm(); }); // clique fora da janela
  $("addClose").addEventListener("click", closeForm);
  $("openAdd").addEventListener("click", () => { if (editing) resetForm(); openForm(); });
  function startEdit(c) {
    if (saving) return;
    resetForm();
    editing = c;
    groupTouched = true;
    fillGroupSelect();
    const e = entries[0];
    e.name.value = c.name;
    e.seller.value = c.seller || "";
    e.price.value = Number(c.price);
    e.fees.fill(c);
    setRadio("fType", c.purchase_type || "individual");
    setRadio("fOrigin", c.origin || "nacional");
    $("fGroup").value = grp(c) ? c.group_id : "";
    $("fGift").checked = !!c.gift;
    const src = c.image_path && photoUrls.get(c.image_path);
    if (src) showPhoto(e, src);
    openForm();
  }
  $("fCancel").addEventListener("click", closeForm);
  function resetForm() {
    editing = null; groupTouched = false;
    entries.forEach((e) => { if (e.previewUrl) URL.revokeObjectURL(e.previewUrl); });
    entries = [];
    $("entries").replaceChildren();
    $("addForm").reset();
    addEntry(false);
  }

  $("addForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const { mode, gift, t, o } = formKind();
    const groupName = $("fGroupName").value.trim();
    if (mode === "new" && !groupName) { $("fGroupName").focus(); return; }
    const blank = entries.find((e) => !e.name.value.trim());
    if (blank) { blank.name.focus(); return; }
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
      let photoFails = 0;
      await Promise.all(entries.map(async (e) => {
        e.path = null;
        if (!e.photoBlob) return;
        const path = `${user.id}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from(BUCKET).upload(path, e.photoBlob, { contentType: "image/jpeg" });
        if (error) photoFails++;
        else { e.path = path; uploaded.push(path); }
      }));
      // num grupo, os fretes próprios do card não são tocados (ficam guardados)
      const values = (e) => {
        const base = { name: e.name.value.trim(), seller: e.seller.value.trim() || null };
        // presente: zera os valores e marca tudo como pago
        if (gift) return { ...base, gift: true, group_id: null, purchase_type: t, origin: o, price: 0, shipping: 0, shipping_to_gom: 0, import_tax: 0,
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
      const what = n > 1 ? `${n} photocards cadastrados` : "Photocard cadastrado";
      toast((photoFails ? `${what}, mas ${plural(photoFails, "foto não foi enviada", "fotos não foram enviadas")}.` : `${what} em ${gift ? "Chegada" : "Pagamento"}.`) + (g && !gift ? ` Grupo: ${g.name}.` : ""));
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

  // ---------- janela de grupos (lista + criar/editar) ----------
  const gdlg = $("groupDialog");
  const gFees = feeInputs(updateGroupTotal);
  $("gFeeFields").append(...gFees.nodes);
  let gEditing = null, gFromList = false, gMembers = new Set(), gSaving = false, gOwnAdded = false;

  function openGroups() { showGroupList(); if (!gdlg.open) gdlg.showModal(); }
  function closeGroups() { if (!gSaving && gdlg.open) gdlg.close(); }
  function showGroupList() {
    gEditing = null; gDetailId = null;
    $("gListView").hidden = false; $("gForm").hidden = true; $("gDetailView").hidden = true; $("gBack").hidden = true;
    $("gTitle").textContent = "Grupos";
    renderGroupList();
  }
  function renderGroupList() {
    const box = $("gItems");
    if (!groups.length) {
      box.replaceChildren(el("div", { class: "empty" }, el("strong", { text: "Nenhum grupo ainda" }),
        el("span", { text: "Crie um grupo para juntar cards da mesma compra, mesmo que já estejam cadastrados." })));
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
          el("button", { class: "btn-ghost", type: "button", text: "Ver", "aria-label": "Ver os cards do grupo " + g.name, onclick: () => openGroupDetail(g, true) }),
          el("button", { class: "btn-ghost", type: "button", text: "Editar", "aria-label": "Editar o grupo " + g.name, onclick: () => openGroupForm(g, true) })));
    }));
  }
  // janela do grupo: abre ao clicar no grupo nas abas ou em "Ver" no botão Grupos.
  // Mostra os valores do grupo, os fretes e a taxa para marcar como pagos e cada card
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
      d > 0 ? el("span", { class: "pill warn" }, document.createTextNode("Falta pagar no grupo "), el("b", { class: "num", text: money(d) }))
        : el("span", { class: "pill ok", text: "Grupo pago" }));
    const head = el("div", { class: "gdetail-head" }, stack(m),
      el("div", { class: "info" }, el("span", { class: "tag tag-group", text: "Grupo · " + kindLabel(g) }), groupMoney(g, m)),
      status);
    const sections = [["pay", "Em Pagamento", rowPay], ["arr", "Em Chegada", rowArr], ["col", "Na Coleção", rowCol]].map(([st, name, fn]) => {
      const list = m.filter((c) => stage(c) === st);
      if (!list.length) return null;
      const all = st === "arr" && list.length > 1 ? el("button", { class: "btn-ok", type: "button", text: `Todos os ${list.length} chegaram ✓`,
        onclick: () => patchMany(list, { arrived: true, arrived_at: new Date().toISOString() }, `${list.length} cards foram para a Coleção!`) }) : null;
      return el("section", { class: "gsection" },
        el("div", { class: "gsection-head" }, el("h3", {}, document.createTextNode(name + " "), el("span", { class: "count", text: list.length })), all),
        el("div", { class: "table" }, ...list.map((c) => fn(c, true))));
    }).filter(Boolean);
    $("gDetailView").replaceChildren(head,
      ...(sections.length ? sections : [el("div", { class: "empty" }, el("span", { text: "Nenhum card neste grupo ainda. Adicione em Editar, no botão Grupos." }))]));
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
    $("gTitle").textContent = g ? "Editar grupo" : "Novo grupo";
    $("gSubmit").textContent = g ? "Salvar grupo" : "Criar grupo";
    $("gDelete").hidden = !g;
    $("gDelConfirm").hidden = true;
    $("gListView").hidden = true; $("gDetailView").hidden = true; $("gForm").hidden = false; $("gBack").hidden = !fromList;
    $("gSearch").hidden = cards.length < 8;
    updateGroupKind();
    renderPicker();
    if (!gdlg.open) gdlg.showModal();
    $("gName").focus();
  }
  function gKind() { return { t: radio("gType") || "individual", o: radio("gOrigin") || "nacional" }; }
  function updateGroupKind() {
    const { t, o } = gKind();
    gFees.show(t, o);
    $("gHint").textContent = HINT[t + "-" + o].replace("em Editar", "em Editar, no botão Grupos");
    updateGroupTotal();
  }
  document.querySelectorAll("input[name=gType], input[name=gOrigin]").forEach((r) => r.addEventListener("change", updateGroupKind));

  const STAGE_NAME = { pay: "Pagamento", arr: "Chegada", col: "Coleção" };
  function renderPicker() {
    const q = $("gSearch").value.trim().toLowerCase();
    const list = cards.filter((c) => !c.gift && (!q || c.name.toLowerCase().includes(q)))
      .sort((a, b) => gMembers.has(b.id) - gMembers.has(a.id)); // os do grupo primeiro
    const box = $("gPicker");
    if (!list.length) {
      box.replaceChildren(el("p", { class: "hint", text: cards.length ? "Nenhum card com esse nome." : "Você ainda não tem cards. Cadastre pelo botão \"+ Cadastrar Photocard\"." }));
      return;
    }
    box.replaceChildren(...list.map((c) => {
      const input = el("input", { type: "checkbox" });
      input.checked = gMembers.has(c.id);
      input.addEventListener("change", () => {
        input.checked ? gMembers.add(c.id) : gMembers.delete(c.id);
        item.classList.toggle("on", input.checked);
        updateGroupTotal();
      });
      const other = grp(c) && (!gEditing || c.group_id !== gEditing.id) ? grp(c) : null;
      const item = el("label", { class: "pick" + (input.checked ? " on" : "") }, input, thumb(c),
        el("span", { class: "pick-info" },
          el("span", { class: "title", text: c.name }),
          el("span", { class: "from", text: [money(c.price), STAGE_NAME[stage(c)], other ? `sai do grupo "${other.name}"` : null].filter(Boolean).join(" · ") })));
      return item;
    }));
  }
  $("gSearch").addEventListener("input", renderPicker);

  function updateGroupTotal() {
    const { t, o } = gKind();
    const sel = cards.filter((c) => gMembers.has(c.id));
    $("gTotal").textContent = money(sumPrices(sel) + gFees.sum(t, o));
    $("gCount").textContent = sel.length;
    // cards sem grupo que tinham fretes próprios: avisa e oferece somar nos fretes do grupo
    const own = sel.filter((c) => !c.group_id && fees(c) > 0);
    const box = $("gOwnFees");
    box.hidden = !own.length;
    if (!own.length) return;
    const ownSum = cents(own.reduce((s, c) => s + fees(c), 0));
    if (gOwnAdded) { box.replaceChildren(el("span", { text: "Somamos os fretes desses cards nos fretes do grupo. Confira os valores acima." })); return; }
    box.replaceChildren(
      el("span", { text: `${own.length === 1 ? "1 card marcado tem" : own.length + " cards marcados têm"} fretes próprios (${money(ownSum)}). No grupo eles deixam de contar, mas ficam guardados caso o card saia do grupo.` }),
      el("button", { class: "btn-ghost", type: "button", text: "Somar nos fretes do grupo", onclick: () => {
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
      const add = cards.filter((c) => gMembers.has(c.id) && c.group_id !== g.id);
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
      toast(wasNew ? `Grupo "${g.name}" criado com ${plural(gMembers.size, "card", "cards")}.` : "Grupo salvo.");
      gFromList ? showGroupList() : closeGroups();
      render();
    } catch (err) {
      setGroupBusy(false);
      toast("Não foi possível salvar o grupo. Tente de novo.");
      loadAll();
    }
  });
  $("gDelete").addEventListener("click", () => {
    const g = gEditing; if (!g) return;
    const n = members(g).length, f = fees(g);
    $("gDelConfirm").replaceChildren(
      el("span", { text: `Excluir o grupo "${g.name}"? ${n === 1 ? "O card continua cadastrado, só fica sem grupo." : n ? `Os ${n} cards continuam cadastrados, só ficam sem grupo.` : ""}${f > 0 ? ` Os fretes e a taxa do grupo (${money(f)}) deixam de ser somados.` : ""}` }),
      el("button", { class: "btn-danger", type: "button", style: "background:var(--danger);color:var(--surface)", text: "Sim, excluir grupo", onclick: () => deleteGroup(g) }),
      el("button", { class: "btn-ghost", type: "button", text: "Cancelar", onclick: () => ($("gDelConfirm").hidden = true) }));
    $("gDelConfirm").hidden = false;
  });
  async function deleteGroup(g) {
    setGroupBusy(true);
    const { error } = await sb.from("card_groups").delete().eq("id", g.id);
    setGroupBusy(false);
    if (error) { toast("Não foi possível excluir o grupo."); return; }
    cards.forEach((c) => { if (c.group_id === g.id) c.group_id = null; });
    setGroups(groups.filter((x) => x.id !== g.id));
    toast("Grupo excluído. Os cards continuam cadastrados.");
    gFromList ? showGroupList() : closeGroups();
    render();
  }
  $("openGroups").addEventListener("click", openGroups);

  // ---------- botão flutuante do celular ----------
  function setFab(open) {
    $("fabMenu").hidden = !open; $("fabShade").hidden = !open;
    $("fabMain").setAttribute("aria-expanded", String(open));
    $("fabMain").setAttribute("aria-label", open ? "Fechar opções" : "Abrir opções: cadastrar photocard ou grupos");
  }
  $("fabMain").addEventListener("click", () => setFab($("fabMenu").hidden));
  $("fabShade").addEventListener("click", () => setFab(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("fabMenu").hidden) setFab(false); });
  $("fabAdd").addEventListener("click", () => { setFab(false); if (editing) resetForm(); openForm(); });
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
    tab = t; confirmClear = false; confirmDelete = null;
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
  // fretes e taxa do grupo: marcar como pago vale para todos os cards dele
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
  async function clearCollection() {
    clearing = true; render();
    const { data: paths, error } = await sb.rpc("clear_collection");
    clearing = false; confirmClear = false;
    if (error) { toast("Não foi possível apagar a coleção. Tente de novo."); render(); return; }
    if (paths && paths.length) sb.storage.from(BUCKET).remove(paths);
    if (editing && editing.arrived) { resetForm(); closeForm(); }
    toast("Coleção apagada. O valor continua no total gasto.");
    await loadAll();
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
  // pilha com até 3 fotos dos cards do grupo
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
    if (grp(c)) return el("div", { class: "money" }, ...lines, el("span", { class: "note", text: "Fretes e taxa no grupo" }));
    return el("div", { class: "money" }, ...lines,
      el("span", { class: "tot", text: "Total" }), el("span", { class: "num tot", text: money(total(c)) }));
  }
  function groupMoney(g, m) {
    const lines = [el("span", { text: `Photocards (${m.length})` }), el("span", { class: "num", text: money(sumPrices(m)) })];
    feeParts(g).forEach((x) => lines.push(el("span", { text: x.label }), el("span", { class: "num", text: money(g[x.key]) })));
    return el("div", { class: "money" }, ...lines,
      el("span", { class: "tot", text: "Total do grupo" }), el("span", { class: "num tot", text: money(groupTotal(g)) }));
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
  // dentro do bloco do grupo o card não repete a categoria; solto, mostra o grupo a que pertence
  function infoBlock(c, inGroup) {
    const g = grp(c);
    return el("div", { class: "info" },
      el("span", { class: "title", text: c.name }),
      inGroup ? null : el("span", { class: "tag" + (g ? " tag-group" : ""), text: c.gift ? "Presente" : g ? "Grupo: " + g.name : kindLabel(c) }),
      c.seller ? el("span", { class: "from" }, document.createTextNode("Vendedor: "), el("b", { text: c.seller })) : null,
      moneyBlock(c));
  }

  // sugestões do campo "Onde comprou": lojas comuns + vendedores que a pessoa já usou
  const COMMON_SELLERS = ["GOM", "Shopee", "Mercado Livre", "Instagram", "X (Twitter)", "Weverse Shop", "Ktown4u", "AliExpress", "Amazon", "Vinted"];
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
        : el("span", { class: "pill warn", text: "Aguardando fretes do grupo" }));
    return el("div", { class: rowClass(inGroup) }, thumb(c), infoBlock(c, inGroup), status, deleteControls(c));
  }
  function rowArr(c, inGroup) {
    // num grupo, "voltar" desmarca só o preço do card (os fretes do grupo valem para todos)
    const undo = grp(c) ? { paid_price: false } : { paid_price: false, paid_shipping: false, paid_shipping_to_gom: false, paid_tax: false };
    const status = el("div", { class: "status" },
      el("span", { class: "pill ok", text: c.gift ? "Presente · sem custo" : "Pago integralmente" }),
      el("div", { class: "checks" },
        el("button", { class: "btn-ok", type: "button", text: "Chegou ✓", onclick: () => patch(c, { arrived: true, arrived_at: new Date().toISOString() }, "Foi para a Coleção!") }),
        c.gift ? null : el("button", { class: "icon-btn", type: "button", text: "Voltar p/ pagamento", onclick: () => patch(c, undo) })));
    return el("div", { class: rowClass(inGroup) }, thumb(c), infoBlock(c, inGroup), status, deleteControls(c));
  }
  function rowCol(c, inGroup) {
    const when = c.arrived_at ? new Date(c.arrived_at).toLocaleDateString("pt-BR") : "";
    const status = el("div", { class: "status" },
      el("span", { class: "pill accent", text: when ? "Chegou em " + when : "Na coleção" }),
      el("button", { class: "icon-btn", type: "button", style: "width:fit-content;padding-left:0", text: "Ainda não chegou", onclick: () => patch(c, { arrived: false, arrived_at: null }) }));
    return el("div", { class: rowClass(inGroup) }, thumb(c), infoBlock(c, inGroup), status, el("div", { class: "actions" }, editButton(c)));
  }

  // cabeçalho do grupo em cada aba: nome, valores compartilhados e o andamento dos cards
  function groupHead(g, here) {
    const m = members(g);
    const info = el("div", { class: "info" },
      el("span", { class: "title", text: g.name }),
      el("span", { class: "tag tag-group", text: "Grupo · " + kindLabel(g) }),
      groupMoney(g, m));
    const status = el("div", { class: "status" });
    const note = (text) => status.append(el("span", { class: "from", text }));
    const countIn = (s) => m.filter((c) => stage(c) === s).length;
    if (tab === "pay") {
      const d = groupDue(g);
      status.append(
        el("div", { class: "checks" }, ...feeParts(g).map((x) => check(x.check, g[x.paid], (v) => patchGroup(g, { [x.paid]: v })))),
        d > 0 ? el("span", { class: "pill warn" }, document.createTextNode("Falta pagar no grupo "), el("b", { class: "num", text: money(d) }))
          : el("span", { class: "pill ok", text: "Grupo pago" }));
      if (!m.length) note("Nenhum card neste grupo ainda. Adicione pelo botão Grupos.");
      else if (here.length < m.length) note(`${m.length - here.length} de ${m.length} cards já saíram de Pagamento.`);
    } else if (tab === "arr") {
      const arrived = countIn("col"), waiting = countIn("pay");
      status.append(el("span", { class: "pill ok", text: "Fretes e taxa pagos" }));
      note(`${arrived} de ${plural(m.length, "card chegou", "cards chegaram")}` + (waiting ? ` · ${waiting} ainda em Pagamento` : ""));
      if (here.length > 1) status.append(el("button", { class: "btn-ok", type: "button", style: "width:fit-content", text: `Todos os ${here.length} chegaram ✓`,
        onclick: () => patchMany(here, { arrived: true, arrived_at: new Date().toISOString() }, `${here.length} cards foram para a Coleção!`) }));
    } else {
      status.append(el("span", { class: "pill accent", text: `${here.length} de ${m.length} na coleção` }));
    }
    // clicar no grupo abre a janela do grupo com os cards dele
    const open = () => openGroupDetail(g, false);
    const head = el("div", { class: "row ghead clickable", role: "button", tabindex: "0", "aria-haspopup": "dialog", "aria-label": "Abrir o grupo " + g.name },
      stack(m), info, status, el("div", { class: "actions" }, el("span", { class: "gopen", "aria-hidden": "true", text: "›" })));
    head.addEventListener("click", (e) => { if (!e.target.closest("button, label, input, a")) open(); });
    head.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === head) { e.preventDefault(); open(); } });
    return head;
  }

  const HEAD = { pay: "Pagamento", arr: "Chegada", col: "Status" };
  const EMPTY = {
    pay: ["Nada pendente de pagamento", "Use o botão \"+ Cadastrar Photocard\". O card aparece aqui até o preço, os fretes e as taxas estarem pagos."],
    arr: ["Nenhum card a caminho", "Quando tudo estiver pago, o card vem para cá esperando chegar."],
    col: ["Sua coleção está vazia", "Cards marcados como \"Chegou\" ficam guardados aqui."],
  };
  function plural(n, s, p) { return `${n} ${n === 1 ? s : p}`; }

  function render() {
    updateSellerList();
    const byStage = { pay: [], arr: [], col: [] };
    cards.forEach((c) => byStage[stage(c)].push(c));

    // fretes e taxas de grupo entram uma vez só
    const live = cards.reduce((s, c) => s + total(c), 0) + groups.reduce((s, g) => s + fees(g), 0);
    const all = cents(live + archived.total);
    const dueSum = cents(cards.reduce((s, c) => s + due(c), 0) + groups.reduce((s, g) => s + feesDue(g), 0));
    const n = cards.length + archived.count;
    const quit = byStage.arr.length + byStage.col.length;
    $("sTotal").textContent = money(all);
    $("sTotalSub").textContent = plural(n, "card", "cards") + (archived.count ? ` · inclui ${archived.count} de coleções apagadas` : " · preço, fretes e taxas");
    $("sPaid").textContent = money(all - dueSum);
    $("sPaidSub").textContent = plural(quit, "quitado", "quitados");
    $("sDue").textContent = money(dueSum);
    $("sDueSub").textContent = `${byStage.pay.length} em aberto`;
    $("cPay").textContent = byStage.pay.length; $("cArr").textContent = byStage.arr.length; $("cCol").textContent = byStage.col.length;
    document.querySelectorAll("#mainTabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    if (gdlg.open && !$("gListView").hidden) renderGroupList();
    if (gdlg.open && gDetailId && !$("gDetailView").hidden) {
      const g = groupsById.get(gDetailId);
      if (g) showGroupDetail(g); else showGroupList();
    }

    const panel = $("panel"); panel.replaceChildren();
    const list = byStage[tab];

    // monta a lista: cards soltos e blocos de grupo, na ordem do card mais recente
    const grouped = tab !== "col" || colView === "groups";
    const items = [], blocks = new Map();
    list.forEach((c) => {
      const g = grouped && grp(c);
      if (!g) { items.push({ card: c }); return; }
      let it = blocks.get(g.id);
      if (!it) { it = { g, cards: [] }; blocks.set(g.id, it); items.push(it); }
      it.cards.push(c);
    });
    // em Pagamento, grupos com frete ou taxa em aberto aparecem mesmo sem cards aqui
    if (tab === "pay") groups.filter((g) => !blocks.has(g.id) && !feesPaid(g)).reverse().forEach((g) => items.unshift({ g, cards: [] }));

    if (tab === "col") {
      // grupo com todos os cards na coleção: os fretes e a taxa entram no valor da coleção
      const full = groups.filter((g) => { const m = members(g); return m.length && m.every((c) => stage(c) === "col"); });
      const colTotal = list.reduce((s, c) => s + total(c), 0) + full.reduce((s, g) => s + fees(g), 0);
      const viewSeg = groups.length ? el("div", { class: "seg", role: "radiogroup", "aria-label": "Ver a coleção" },
        ...[["cards", "Cards"], ["groups", "Por grupo"]].map(([v, label]) => {
          const r = el("input", { type: "radio", name: "colView", value: v });
          r.checked = colView === v;
          r.addEventListener("change", () => setColView(v));
          return el("label", {}, r, el("span", { text: label }));
        })) : null;
      panel.append(el("div", { class: "panel-head" },
        el("p", {}, document.createTextNode(plural(list.length, "card", "cards") + " · "), el("span", { class: "num", text: money(colTotal) })),
        el("div", { class: "panel-tools" }, viewSeg,
          list.length && !confirmClear ? el("button", { class: "btn-danger", type: "button", text: "Apagar coleção", onclick: () => { confirmClear = true; render(); } }) : null)));
      if (confirmClear) {
        panel.append(el("div", { class: "confirm" },
          el("span", { text: `Apagar os ${plural(list.length, "card", "cards")} da coleção e suas fotos? O valor continua somado no total gasto.` + (full.length ? ` ${full.length === 1 ? "O grupo que fica vazio também é apagado" : "Os grupos que ficam vazios também são apagados"}.` : "") }),
          el("button", { class: "btn-danger", type: "button", style: "background:var(--danger);color:var(--surface)", disabled: clearing ? "" : null, text: clearing ? "Apagando…" : "Sim, apagar", onclick: clearCollection }),
          el("button", { class: "btn-ghost", type: "button", text: "Cancelar", onclick: () => { confirmClear = false; render(); } })));
      }
    }

    const table = el("div", { class: "table" });
    if (loading) {
      table.append(el("div", { class: "empty" }, el("strong", { text: "Carregando seus cards…" })));
    } else if (!items.length) {
      const [t, s] = EMPTY[tab];
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

  setMode("login");
  resetForm();
  sb.auth.getSession().then(({ data }) => { if (!data.session) show("authView"); });
})();
