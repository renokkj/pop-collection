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
  let archived = { total: 0, count: 0 };
  let photoUrls = new Map(); // image_path -> signed url
  let tab = "pay";
  try { const t = localStorage.getItem("pc-tab"); if (["pay", "arr", "col"].includes(t)) tab = t; } catch (e) {}
  let loading = true, confirmClear = false, confirmDelete = null, clearing = false;
  let photoBlob = null, photoPreviewUrl = null;
  const busy = new Set();

  const stage = (c) => (c.arrived ? "col" : c.paid_price && c.paid_shipping ? "arr" : "pay");
  const total = (c) => cents(Number(c.price) + Number(c.shipping));
  const due = (c) => cents((c.paid_price ? 0 : Number(c.price)) + (c.paid_shipping ? 0 : Number(c.shipping)));

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
    else if (!next) { user = null; cards = []; photoUrls = new Map(); setMode("login"); show("authView"); }
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
      const [{ data: rows, error: e1 }, { data: st, error: e2 }] = await Promise.all([
        sb.from("cards").select("*").order("created_at", { ascending: false }),
        sb.from("stats").select("*").maybeSingle(),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      cards = rows || [];
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

  // ---------- formulário ----------
  function updateFormTotal() { $("fTotal").textContent = money(cents($("fPrice").value) + cents($("fShip").value)); }
  $("fPrice").addEventListener("input", updateFormTotal);
  $("fShip").addEventListener("input", updateFormTotal);

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
  $("fPhoto").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      photoBlob = await shrink(file);
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
      photoPreviewUrl = URL.createObjectURL(photoBlob);
      let img = $("drop").querySelector("img");
      if (!img) { img = document.createElement("img"); img.alt = ""; $("drop").prepend(img); }
      img.src = photoPreviewUrl;
      $("dropText").hidden = true;
    } catch (err) { photoBlob = null; toast("Não deu para ler essa imagem. Tente um JPG ou PNG."); }
  });
  function resetForm() {
    $("addForm").reset(); updateFormTotal(); photoBlob = null;
    const img = $("drop").querySelector("img"); if (img) img.remove();
    if (photoPreviewUrl) { URL.revokeObjectURL(photoPreviewUrl); photoPreviewUrl = null; }
    $("dropText").hidden = false;
  }

  $("addForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("fName").value.trim();
    if (!name) { $("fName").focus(); return; }
    $("fSubmit").disabled = true; $("formMsg").textContent = "Salvando…";
    let path = null;
    try {
      if (photoBlob) {
        path = `${user.id}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from(BUCKET).upload(path, photoBlob, { contentType: "image/jpeg" });
        if (error) { path = null; toast("A foto não foi enviada, mas o card será salvo sem ela."); }
      }
      const { data, error } = await sb.from("cards")
        .insert({ name, seller: $("fSeller").value.trim() || null, price: cents($("fPrice").value), shipping: cents($("fShip").value), image_path: path })
        .select().single();
      if (error) throw error;
      if (path && photoPreviewUrl) photoUrls.set(path, photoPreviewUrl), (photoPreviewUrl = null);
      cards.unshift(data);
      resetForm();
      toast("Photocard cadastrado em Pagamento.");
      tab = "pay"; render();
      signPhotos().then(render);
    } catch (err) {
      if (path) sb.storage.from(BUCKET).remove([path]);
      toast("Não foi possível salvar. Tente de novo.");
    } finally {
      $("fSubmit").disabled = false; $("formMsg").textContent = "O card entra na aba Pagamento.";
    }
  });

  // ---------- abas ----------
  function setTab(t) {
    tab = t; confirmClear = false; confirmDelete = null;
    try { localStorage.setItem("pc-tab", t); } catch (e) {}
    render();
  }
  document.querySelectorAll("#mainTabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

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
  async function removeCard(c) {
    const { error } = await sb.from("cards").delete().eq("id", c.id);
    if (error) { toast("Não foi possível apagar."); return; }
    if (c.image_path) sb.storage.from(BUCKET).remove([c.image_path]);
    cards = cards.filter((x) => x.id !== c.id);
    toast("Card apagado.");
    render();
  }
  async function clearCollection() {
    clearing = true; render();
    const { data: paths, error } = await sb.rpc("clear_collection");
    clearing = false; confirmClear = false;
    if (error) { toast("Não foi possível apagar a coleção. Tente de novo."); render(); return; }
    if (paths && paths.length) sb.storage.from(BUCKET).remove(paths);
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
  function moneyBlock(c) {
    return el("div", { class: "money" },
      el("span", { text: "Preço" }), el("span", { class: "num", text: money(c.price) }),
      el("span", { text: "Frete" }), el("span", { class: "num", text: money(c.shipping) }),
      el("span", { class: "tot", text: "Total" }), el("span", { class: "num tot", text: money(total(c)) }));
  }
  function check(label, on, fn) {
    const input = el("input", { type: "checkbox" }); input.checked = !!on;
    input.addEventListener("change", () => fn(input.checked));
    return el("label", { class: "chk" + (on ? " on" : "") }, input, document.createTextNode(label));
  }
  function deleteControls(c) {
    if (confirmDelete === c.id) {
      return el("div", { class: "actions" },
        el("button", { class: "btn-danger", type: "button", text: "Apagar", onclick: () => { confirmDelete = null; removeCard(c); } }),
        el("button", { class: "icon-btn", type: "button", text: "Cancelar", onclick: () => { confirmDelete = null; render(); } }));
    }
    return el("div", { class: "actions" },
      el("button", { class: "icon-btn", type: "button", text: "Excluir", "aria-label": "Excluir " + c.name, onclick: () => { confirmDelete = c.id; render(); } }));
  }
  const infoBlock = (c) => el("div", { class: "info" },
    el("span", { class: "title", text: c.name }),
    c.seller ? el("span", { class: "from" }, document.createTextNode("Vendedor: "), el("b", { text: c.seller })) : null,
    moneyBlock(c));

  // sugestões do campo "Onde comprou": lojas comuns + vendedores que a pessoa já usou
  const COMMON_SELLERS = ["GOM", "Shopee", "Mercado Livre", "Instagram", "X (Twitter)", "Weverse Shop", "Ktown4u", "AliExpress", "Amazon", "Vinted"];
  function updateSellerList() {
    const seen = new Map();
    cards.forEach((c) => { if (c.seller) seen.set(c.seller.toLowerCase(), c.seller); });
    COMMON_SELLERS.forEach((s) => { if (!seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s); });
    $("sellerList").replaceChildren(...[...seen.values()].map((v) => el("option", { value: v })));
  }

  function rowPay(c) {
    const status = el("div", { class: "status" },
      el("div", { class: "checks" },
        check("Preço pago", c.paid_price, (v) => patch(c, { paid_price: v }, v && c.paid_shipping ? "Tudo pago! Foi para Chegada." : null)),
        check("Frete pago", c.paid_shipping, (v) => patch(c, { paid_shipping: v }, v && c.paid_price ? "Tudo pago! Foi para Chegada." : null))),
      el("span", { class: "pill warn" }, document.createTextNode("Falta pagar "), el("b", { class: "num", text: money(due(c)) })));
    return el("div", { class: "row" }, thumb(c), infoBlock(c), status, deleteControls(c));
  }
  function rowArr(c) {
    const status = el("div", { class: "status" },
      el("span", { class: "pill ok", text: "Pago integralmente" }),
      el("div", { class: "checks" },
        el("button", { class: "btn-ok", type: "button", text: "Chegou ✓", onclick: () => patch(c, { arrived: true, arrived_at: new Date().toISOString() }, "Foi para a Coleção!") }),
        el("button", { class: "icon-btn", type: "button", text: "Voltar p/ pagamento", onclick: () => patch(c, { paid_price: false, paid_shipping: false }) })));
    return el("div", { class: "row" }, thumb(c), infoBlock(c), status, deleteControls(c));
  }
  function rowCol(c) {
    const when = c.arrived_at ? new Date(c.arrived_at).toLocaleDateString("pt-BR") : "";
    const status = el("div", { class: "status" },
      el("span", { class: "pill accent", text: when ? "Chegou em " + when : "Na coleção" }),
      el("button", { class: "icon-btn", type: "button", style: "width:fit-content;padding-left:0", text: "Ainda não chegou", onclick: () => patch(c, { arrived: false, arrived_at: null }) }));
    return el("div", { class: "row" }, thumb(c), infoBlock(c), status, el("div", { class: "actions" }));
  }

  const HEAD = { pay: "Pagamento", arr: "Chegada", col: "Status" };
  const EMPTY = {
    pay: ["Nada pendente de pagamento", "Cadastre um photocard acima. Ele aparece aqui até preço e frete estarem pagos."],
    arr: ["Nenhum card a caminho", "Quando preço e frete estiverem pagos, o card vem para cá esperando chegar."],
    col: ["Sua coleção está vazia", "Cards marcados como \"Chegou\" ficam guardados aqui."],
  };
  const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

  function render() {
    updateSellerList();
    const groups = { pay: [], arr: [], col: [] };
    cards.forEach((c) => groups[stage(c)].push(c));

    const live = cards.reduce((s, c) => s + total(c), 0);
    const all = cents(live + archived.total);
    const dueSum = cents(cards.reduce((s, c) => s + due(c), 0));
    const n = cards.length + archived.count;
    const quit = groups.arr.length + groups.col.length;
    $("sTotal").textContent = money(all);
    $("sTotalSub").textContent = plural(n, "card", "cards") + (archived.count ? ` · inclui ${archived.count} de coleções apagadas` : " · preço + frete");
    $("sPaid").textContent = money(all - dueSum);
    $("sPaidSub").textContent = plural(quit, "quitado", "quitados");
    $("sDue").textContent = money(dueSum);
    $("sDueSub").textContent = `${groups.pay.length} em aberto`;
    $("cPay").textContent = groups.pay.length; $("cArr").textContent = groups.arr.length; $("cCol").textContent = groups.col.length;
    document.querySelectorAll("#mainTabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));

    const panel = $("panel"); panel.replaceChildren();
    const list = groups[tab];

    if (tab === "col") {
      const colTotal = list.reduce((s, c) => s + total(c), 0);
      panel.append(el("div", { class: "panel-head" },
        el("p", {}, document.createTextNode(plural(list.length, "card", "cards") + " · "), el("span", { class: "num", text: money(colTotal) })),
        list.length && !confirmClear ? el("button", { class: "btn-danger", type: "button", text: "Apagar coleção", onclick: () => { confirmClear = true; render(); } }) : null));
      if (confirmClear) {
        panel.append(el("div", { class: "confirm" },
          el("span", { text: `Apagar os ${plural(list.length, "card", "cards")} da coleção e suas fotos? O valor continua somado no total gasto.` }),
          el("button", { class: "btn-danger", type: "button", style: "background:var(--danger);color:var(--surface)", disabled: clearing ? "" : null, text: clearing ? "Apagando…" : "Sim, apagar", onclick: clearCollection }),
          el("button", { class: "btn-ghost", type: "button", text: "Cancelar", onclick: () => { confirmClear = false; render(); } })));
      }
    }

    const table = el("div", { class: "table" });
    if (loading) {
      table.append(el("div", { class: "empty" }, el("strong", { text: "Carregando seus cards…" })));
    } else if (!list.length) {
      const [t, s] = EMPTY[tab];
      table.append(el("div", { class: "empty" }, el("strong", { text: t }), el("span", { text: s })));
    } else {
      table.append(el("div", { class: "thead" }, el("span", { text: "Foto" }), el("span", { text: "Card · Valores" }), el("span", { text: HEAD[tab] }), el("span", {})));
      const fn = tab === "pay" ? rowPay : tab === "arr" ? rowArr : rowCol;
      list.forEach((c) => table.append(fn(c)));
    }
    panel.append(table);
  }

  setMode("login");
  sb.auth.getSession().then(({ data }) => { if (!data.session) show("authView"); });
})();
