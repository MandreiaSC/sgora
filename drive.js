// SGO_RA — Sistema de Gestão em Osteopatia. © 2026 Marcia Sales. Todos os direitos reservados (Lei 9.609/1998).
// Celular ↔ Google Drive: entrar com o Google (permissão "drive.file": só os arquivos do próprio SGO_RA) e ler a pasta
// de sincronização que o notebook criou. Nos testes da oficina (localhost ?teste=1), lê uma pasta do computador.
(function () {
  'use strict';
  const CLIENTE = '668705708420-atshe9peedf5efob0mruif4hs27juurq.apps.googleusercontent.com';
  const ESCOPO = 'https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const PASTA = 'SGO_RA_Sincronizacao';
  const CHAVE_PASSE = 'sgora_passe_google';   // passe de 1 hora (só para não pedir de novo a cada toque)

  const modoTeste = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('teste');

  // ---------- passe do Google ----------
  let passe = null;   // { token, vence }
  try { const p = JSON.parse(localStorage.getItem(CHAVE_PASSE) || 'null'); if (p && p.vence > Date.now()) passe = p; } catch (e) { /* sem passe */ }
  function temPasse() { return modoTeste || !!(passe && passe.vence > Date.now()); }

  let clienteToken = null, esperando = null;
  function carregarGoogle() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => ok(); s.onerror = () => erro(new Error('Sem internet.'));
      document.head.appendChild(s);
    });
  }
  // precisa ser chamado a partir de um toque (o Google abre a janela de entrar)
  async function entrar() {
    if (modoTeste) return { email: 'teste.sinc@exemplo.com' };
    await carregarGoogle();
    return new Promise((ok, erro) => {
      esperando = { ok, erro };
      if (!clienteToken) {
        clienteToken = google.accounts.oauth2.initTokenClient({
          client_id: CLIENTE, scope: ESCOPO, prompt: '',
          callback: (r) => {
            const e = esperando; esperando = null;
            if (!e) return;
            if (r.error || !google.accounts.oauth2.hasGrantedAllScopes(r, ESCOPO)) { e.erro(new Error(r.error ? 'Não foi possível entrar no Google.' : 'Marque a permissão do Google Drive.')); return; }
            passe = { token: r.access_token, vence: Date.now() + (Number(r.expires_in || 3600) - 60) * 1000 };
            try { localStorage.setItem(CHAVE_PASSE, JSON.stringify(passe)); } catch (x) { /* sem armazenamento */ }
            e.ok({});
          },
          error_callback: (r) => { const e = esperando; esperando = null; if (e) e.erro(new Error(r && r.type === 'popup_closed' ? 'CANCELADO' : 'Não foi possível entrar no Google.')); },
        });
      }
      clienteToken.requestAccessToken();
    });
  }
  function esquecer() { passe = null; try { localStorage.removeItem(CHAVE_PASSE); } catch (e) { /* nada */ } }

  async function pedir(url) {
    if (!temPasse()) { const e = new Error('Entre com o Google para atualizar.'); e.code = 'SEM_PASSE'; throw e; }
    let r;
    try { r = await fetch(url, { headers: { Authorization: 'Bearer ' + passe.token } }); }
    catch (x) { const e = new Error('Sem internet.'); e.code = 'SEM_INTERNET'; throw e; }
    if (r.status === 401) { esquecer(); const e = new Error('Entre com o Google para atualizar.'); e.code = 'SEM_PASSE'; throw e; }
    return r;
  }

  // ---------- pasta de sincronização ----------
  let idPasta = null; const ids = new Map();
  async function pasta() {
    if (idPasta) return idPasta;
    const q = encodeURIComponent(`name='${PASTA}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const j = await (await pedir(`${API}?q=${q}&fields=files(id)&orderBy=createdTime&spaces=drive`)).json();
    if (!j.files || !j.files.length) { const e = new Error('A pasta da sincronização ainda não existe. Ligue a sincronização no notebook primeiro.'); e.code = 'SEM_PASTA'; throw e; }
    idPasta = j.files[0].id;
    return idPasta;
  }
  const transporteDrive = {
    async listar() {
      const p = await pasta(); const nomes = []; let pag = '';
      do {
        const q = encodeURIComponent(`'${p}' in parents and trashed=false`);
        const j = await (await pedir(`${API}?q=${q}&fields=nextPageToken,files(id,name)&pageSize=1000&spaces=drive${pag ? '&pageToken=' + pag : ''}`)).json();
        for (const f of j.files || []) { ids.set(f.name, f.id); nomes.push(f.name); }
        pag = j.nextPageToken || '';
      } while (pag);
      return nomes;
    },
    async ler(nome) {
      if (!ids.has(nome)) await transporteDrive.listar();
      const id = ids.get(nome); if (!id) return null;
      const r = await pedir(`${API}/${id}?alt=media`);
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    },
    // grava um arquivo NOVO na pasta (o celular só cria lotes novos; nunca reescreve)
    async gravar(nome, bytes) {
      const p = await pasta();
      const limite = 'sgora' + Math.random().toString(16).slice(2);
      const meta = JSON.stringify({ name: nome, parents: [p] });
      const corpo = new Blob([`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${limite}\r\nContent-Type: application/octet-stream\r\n\r\n`, bytes, `\r\n--${limite}--`]);
      if (!temPasse()) { const e = new Error('Entre com o Google para enviar.'); e.code = 'SEM_PASSE'; throw e; }
      let r;
      try { r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', { method: 'POST', headers: { Authorization: 'Bearer ' + passe.token, 'Content-Type': 'multipart/related; boundary=' + limite }, body: corpo }); }
      catch (x) { const e = new Error('Sem internet.'); e.code = 'SEM_INTERNET'; throw e; }
      if (r.status === 401) { esquecer(); const e = new Error('Entre com o Google para enviar.'); e.code = 'SEM_PASSE'; throw e; }
      if (!r.ok) throw new Error('Não foi possível enviar ao Google Drive.');
      const j = await r.json(); ids.set(j.name, j.id);
    },
  };
  // testes da oficina: pasta do computador servida pelo servidor de teste
  const transporteTeste = {
    async listar() { return (await fetch('/comum/')).json(); },
    async ler(nome) { const r = await fetch('/comum/' + encodeURIComponent(nome)); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; },
    async gravar(nome, bytes) {
      let r; try { r = await fetch('/comum/' + encodeURIComponent(nome), { method: 'POST', body: bytes }); } catch (x) { const e = new Error('Sem internet.'); e.code = 'SEM_INTERNET'; throw e; }
      if (!r.ok) throw new Error('Não foi possível enviar.');
    },
  };

  window.SgoDrive = { modoTeste, temPasse, entrar, esquecer, transporte: modoTeste ? transporteTeste : transporteDrive };
})();
