// SGO_RA — Sistema de Gestão em Osteopatia. © 2026 Marcia Sales. Todos os direitos reservados (Lei 9.609/1998).
// Armazém do celular (IndexedDB). Os dados ficam CRIPTOGRAFADOS com a chave da sincronização, que é guardada
// no aparelho como "chave que não pode ser copiada para fora" (a pessoa não consegue exportá-la, nem um site).
(function () {
  'use strict';
  const BANCO = 'sgora', LOJA = 'k';
  function abrir() {
    return new Promise((ok, erro) => {
      const r = indexedDB.open(BANCO, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(LOJA);
      r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error);
    });
  }
  async function op(modo, fn) {
    const db = await abrir();
    return new Promise((ok, erro) => {
      const t = db.transaction(LOJA, modo); const loja = t.objectStore(LOJA);
      const req = fn(loja);
      t.oncomplete = () => { db.close(); ok(req ? req.result : undefined); };
      t.onerror = () => { db.close(); erro(t.error); };
    });
  }
  const ler = (k) => op('readonly', (l) => l.get(k));
  const gravar = (k, v) => op('readwrite', (l) => l.put(v, k));
  const apagarTudo = () => op('readwrite', (l) => l.clear());

  async function gravarEstado(chave, estado) {
    const dados = new TextEncoder().encode(JSON.stringify({ aplicados: [...estado.aplicados], registros: [...estado.registros], ultima: estado.ultima || null,
      pendentes: [...(estado.pendentes || new Map())], aparelho: estado.aparelho || null, anexosPendentes: estado.anexosPendentes || [] }));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('sgora-celular-estado') }, chave, dados);
    await gravar('estado', { iv, dados: new Uint8Array(cifrado) });
  }
  async function lerEstado(chave) {
    const e = await ler('estado');
    if (!e) return null;
    const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: e.iv, additionalData: new TextEncoder().encode('sgora-celular-estado') }, chave, e.dados);
    const o = JSON.parse(new TextDecoder().decode(claro));
    return { aplicados: new Set(o.aplicados), registros: new Map(o.registros), ultima: o.ultima || null,
      pendentes: new Map(o.pendentes || []), anexosPendentes: o.anexosPendentes || [], aparelho: o.aparelho || ('cel' + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('')) };
  }

  // textos guardados criptografados (ex.: aparência dos documentos, com a assinatura)
  async function gravarTexto(chave, k, texto) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('sgora-celular-' + k) }, chave, new TextEncoder().encode(texto));
    await gravar('t_' + k, { iv, dados: new Uint8Array(cifrado) });
  }
  async function lerTexto(chave, k) {
    const e = await ler('t_' + k);
    if (!e) return null;
    try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: e.iv, additionalData: new TextEncoder().encode('sgora-celular-' + k) }, chave, e.dados)); }
    catch { return null; }
  }

  const apagarTexto = (k) => op('readwrite', (l) => l.delete('t_' + k));

  window.SgoArmazem = { ler, gravar, apagarTudo, gravarEstado, lerEstado, gravarTexto, lerTexto, apagarTexto };
})();
