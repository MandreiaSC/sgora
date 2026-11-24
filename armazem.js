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
    const dados = new TextEncoder().encode(JSON.stringify({ aplicados: [...estado.aplicados], registros: [...estado.registros], ultima: estado.ultima || null }));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('sgora-celular-estado') }, chave, dados);
    await gravar('estado', { iv, dados: new Uint8Array(cifrado) });
  }
  async function lerEstado(chave) {
    const e = await ler('estado');
    if (!e) return null;
    const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: e.iv, additionalData: new TextEncoder().encode('sgora-celular-estado') }, chave, e.dados);
    const o = JSON.parse(new TextDecoder().decode(claro));
    return { aplicados: new Set(o.aplicados), registros: new Map(o.registros), ultima: o.ultima || null };
  }

  window.SgoArmazem = { ler, gravar, apagarTudo, gravarEstado, lerEstado };
})();
