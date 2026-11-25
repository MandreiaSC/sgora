// SGO_RA — Sistema de Gestão em Osteopatia. © 2026 Marcia Sales. Todos os direitos reservados (Lei 9.609/1998).
// Núcleo do SGO_RA no celular: abre o "cadeado" da pasta de sincronização com o código do cofre e lê os lotes que
// o notebook (e outros aparelhos) gravaram — no mesmo formato do app\sincronizacao.js do notebook.
// Tudo é feito NO PRÓPRIO APARELHO (WebCrypto): nada sai decifrado para lugar nenhum.
// Funciona no navegador (iPhone/Android) e no Node (testes da oficina).
(function (raiz) {
  'use strict';
  const sutil = (raiz.crypto && raiz.crypto.subtle) || require('crypto').webcrypto.subtle;
  const FORMATO = 'sgo-ra-sinc';
  const ARQ_CABECALHO = 'sinc_cabecalho.json';
  const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const AAD_EMBRULHO = 'sgo-ra-chave-do-cofre';
  const CAMPO_CARIMBO = 'atualizadoEm';
  const CAMPO_PID = '__pid';
  // mesmas gavetas do notebook (cofre.js → GAVETAS_REGISTRADAS)
  const GAVETAS = {
    raq_pacientes: 'lista', raq_usuarios: 'lista', raq_lembretes: 'lista', raq_agendamentos: 'lista',
    raq_consultas: 'lista', raq_financeiro: 'lista', raq_anamnese: 'porPaciente', raq_exame: 'porPaciente',
    raq_arquivos_pacientes: 'arquivos',
  };

  // ---------- ajudas ----------
  const txt = new TextEncoder(), dtxt = new TextDecoder();
  function deBase64(s) {
    if (typeof atob === 'function') { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
    return new Uint8Array(Buffer.from(s, 'base64'));
  }
  const juntar = (...partes) => { const n = partes.reduce((s, p) => s + p.length, 0); const u = new Uint8Array(n); let o = 0; for (const p of partes) { u.set(p, o); o += p.length; } return u; };
  const normalizarCodigo = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const codigoValido = (c) => { const n = normalizarCodigo(c); return n.length === 24 && [...n].every((ch) => ALFABETO_CODIGO.includes(ch)); };
  async function desgzip(bytes) {
    const fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(fluxo).arrayBuffer());
  }
  async function gzip(bytes) {
    const fluxo = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(fluxo).arrayBuffer());
  }
  function paraBase64(u) {
    if (typeof btoa === 'function') { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
    return Buffer.from(u).toString('base64');
  }

  // ---------- scrypt (N=2^15, r=8, p=1), igual ao crypto.scryptSync do notebook ----------
  async function pbkdf2(senha, sal, bytes) {
    const k = await sutil.importKey('raw', senha, 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await sutil.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: 1 }, k, bytes * 8));
  }
  function salsa8(B) {
    const x = B.slice();
    const R = (a, b) => (a << b) | (a >>> (32 - b));
    for (let i = 0; i < 8; i += 2) {
      x[4] ^= R(x[0] + x[12], 7); x[8] ^= R(x[4] + x[0], 9); x[12] ^= R(x[8] + x[4], 13); x[0] ^= R(x[12] + x[8], 18);
      x[9] ^= R(x[5] + x[1], 7); x[13] ^= R(x[9] + x[5], 9); x[1] ^= R(x[13] + x[9], 13); x[5] ^= R(x[1] + x[13], 18);
      x[14] ^= R(x[10] + x[6], 7); x[2] ^= R(x[14] + x[10], 9); x[6] ^= R(x[2] + x[14], 13); x[10] ^= R(x[6] + x[2], 18);
      x[3] ^= R(x[15] + x[11], 7); x[7] ^= R(x[3] + x[15], 9); x[11] ^= R(x[7] + x[3], 13); x[15] ^= R(x[11] + x[7], 18);
      x[1] ^= R(x[0] + x[3], 7); x[2] ^= R(x[1] + x[0], 9); x[3] ^= R(x[2] + x[1], 13); x[0] ^= R(x[3] + x[2], 18);
      x[6] ^= R(x[5] + x[4], 7); x[7] ^= R(x[6] + x[5], 9); x[4] ^= R(x[7] + x[6], 13); x[5] ^= R(x[4] + x[7], 18);
      x[11] ^= R(x[10] + x[9], 7); x[8] ^= R(x[11] + x[10], 9); x[9] ^= R(x[8] + x[11], 13); x[10] ^= R(x[9] + x[8], 18);
      x[12] ^= R(x[15] + x[14], 7); x[13] ^= R(x[12] + x[15], 9); x[14] ^= R(x[13] + x[12], 13); x[15] ^= R(x[14] + x[13], 18);
    }
    for (let i = 0; i < 16; i++) B[i] = (B[i] + x[i]) | 0;
  }
  function blockMix(B, Y, r) {
    const X = B.slice((2 * r - 1) * 16, 2 * r * 16);
    for (let i = 0; i < 2 * r; i++) {
      for (let j = 0; j < 16; j++) X[j] ^= B[i * 16 + j];
      salsa8(X);
      Y.set(X, i * 16);
    }
    for (let i = 0; i < r; i++) { B.set(Y.subarray(2 * i * 16, 2 * i * 16 + 16), i * 16); B.set(Y.subarray((2 * i + 1) * 16, (2 * i + 1) * 16 + 16), (r + i) * 16); }
  }
  async function scrypt(senha, sal, N = 32768, r = 8, dkLen = 32) {
    const B8 = await pbkdf2(senha, sal, 128 * r);
    const X = new Uint32Array(32 * r);
    for (let i = 0; i < 32 * r; i++) X[i] = B8[i * 4] | (B8[i * 4 + 1] << 8) | (B8[i * 4 + 2] << 16) | (B8[i * 4 + 3] << 24);
    const V = new Uint32Array(32 * r * N), Y = new Uint32Array(32 * r);
    for (let i = 0; i < N; i++) { V.set(X, i * 32 * r); blockMix(X, Y, r); }
    for (let i = 0; i < N; i++) {
      const j = X[(2 * r - 1) * 16] & (N - 1);
      for (let k = 0; k < 32 * r; k++) X[k] ^= V[j * 32 * r + k];
      blockMix(X, Y, r);
    }
    const saida = new Uint8Array(128 * r);
    for (let i = 0; i < 32 * r; i++) { saida[i * 4] = X[i] & 255; saida[i * 4 + 1] = (X[i] >>> 8) & 255; saida[i * 4 + 2] = (X[i] >>> 16) & 255; saida[i * 4 + 3] = (X[i] >>> 24) & 255; }
    return pbkdf2(senha, saida, dkLen);
  }

  // ---------- AES-256-GCM (formato do notebook: iv | tag | corpo, ou JSON {iv, tag, dados}) ----------
  async function decifrarGcm(chave, iv, tag, corpo, aad) {
    const k = chave instanceof Uint8Array ? await sutil.importKey('raw', chave, 'AES-GCM', false, ['decrypt']) : chave;
    return new Uint8Array(await sutil.decrypt({ name: 'AES-GCM', iv, additionalData: txt.encode(aad), tagLength: 128 }, k, juntar(corpo, tag)));
  }
  async function decifrarArquivo(chave, nome, bytes) {
    const b = JSON.parse(dtxt.decode(bytes));
    if (b.formato !== FORMATO) throw new Error('Arquivo de sincronização desconhecido.');
    return desgzip(await decifrarGcm(chave, deBase64(b.iv), deBase64(b.tag), deBase64(b.dados), nome));
  }

  // Abre o cadeado da pasta comum: devolve a chave da sincronização (CryptoKey que não pode ser copiada para fora)
  async function abrirCadeado(textoCabecalho, codigo) {
    if (!codigoValido(codigo)) { const e = new Error('Código do cofre incompleto ou com caracteres inválidos.'); e.code = 'CODIGO_INVALIDO'; throw e; }
    const cab = JSON.parse(textoCabecalho);
    if (cab.formato !== FORMATO) throw new Error('A pasta da sincronização tem um arquivo desconhecido.');
    const kek = await scrypt(txt.encode(normalizarCodigo(codigo)), deBase64(cab.salt));
    const emb = deBase64(cab.chaveEmbrulhada);
    let bruta;
    try { bruta = await decifrarGcm(kek, emb.subarray(0, 12), emb.subarray(12, 28), emb.subarray(28), AAD_EMBRULHO); }
    catch { const e = new Error('Código do cofre incorreto.'); e.code = 'CODIGO_INCORRETO'; throw e; }
    return sutil.importKey('raw', bruta, 'AES-GCM', false, ['decrypt', 'encrypt']);
  }

  // ---------- leitura dos lotes ----------
  // estado = { aplicados: Set de nomes de lotes já lidos, registros: Map "gaveta|id" → { v (registro ou null), em } }
  // pendentes: Map "gaveta|id" → { v, em, base } — alterações feitas no celular que ainda não foram enviadas
  function novoEstado() { return { aplicados: new Set(), registros: new Map(), pendentes: new Map(), aparelho: 'cel' + sorteio(4) }; }

  async function lerNovidades(chave, transporte, estado, aoProgresso) {
    const nomes = (await transporte.listar()).filter((n) => /^lote_.*\.sgsync$/.test(n) && !estado.aplicados.has(n)).sort();
    let recebidas = 0, i = 0;
    for (const nome of nomes) {
      i++;
      if (aoProgresso) aoProgresso(i, nomes.length);
      const arq = await transporte.ler(nome);
      if (!arq) continue;
      const lote = JSON.parse(dtxt.decode(await decifrarArquivo(chave, nome, arq)));
      for (const m of lote.mudancas || []) {
        const atual = estado.registros.get(m.k);
        if (!atual || String(m.em) >= String(atual.em)) { estado.registros.set(m.k, { v: m.v === undefined ? null : m.v, em: String(m.em) }); recebidas++; }
      }
      estado.aplicados.add(nome);
    }
    return { recebidas, lotes: nomes.length };
  }

  // monta as gavetas no formato do notebook (o que o sistema guarda em cada "raq_...")
  function montarGavetas(estado) {
    const g = {};
    for (const [nome, tipo] of Object.entries(GAVETAS)) g[nome] = tipo === 'lista' ? [] : {};
    for (const [k, r] of estado.registros) {
      if (!r.v) continue;
      const i = k.indexOf('|'); const gaveta = k.slice(0, i), id = k.slice(i + 1);
      const tipo = GAVETAS[gaveta];
      if (tipo === 'lista') g[gaveta].push(r.v);
      else if (tipo === 'porPaciente') g[gaveta][id] = r.v;
      else if (tipo === 'arquivos') { const { [CAMPO_PID]: pid, ...item } = r.v; (g[gaveta][pid] = g[gaveta][pid] || []).push(item); }
    }
    return g;
  }

  // ---------- envio (o celular grava um lote no MESMO formato do notebook: gzip + AES-256-GCM, rótulo = nome) ----------
  async function cifrarArquivo(chave, nome, bytes) {
    const iv = (raiz.crypto || require('crypto').webcrypto).getRandomValues(new Uint8Array(12));
    const saida = new Uint8Array(await sutil.encrypt({ name: 'AES-GCM', iv, additionalData: txt.encode(nome), tagLength: 128 }, chave, await gzip(bytes)));
    const corpo = saida.subarray(0, saida.length - 16), tag = saida.subarray(saida.length - 16);
    return txt.encode(JSON.stringify({ formato: FORMATO, iv: paraBase64(iv), tag: paraBase64(tag), dados: paraBase64(corpo) }));
  }
  const carimboLote = () => new Date().toISOString().replace(/[-:.]/g, '');
  function sorteio(n) { const u = (raiz.crypto || require('crypto').webcrypto).getRandomValues(new Uint8Array(n)); return [...u].map((b) => b.toString(16).padStart(2, '0')).join(''); }
  // mudancas = [{ k: 'gaveta|id', v: registro (ou null = excluído), em }]
  async function enviarLote(chave, transporte, aparelho, mudancas) {
    const nome = `lote_${carimboLote()}_${aparelho}_${sorteio(3)}.sgsync`;
    const corpo = txt.encode(JSON.stringify({ aparelho, nomeAparelho: 'celular', criadoEm: new Date().toISOString(), mudancas }));
    await transporte.gravar(nome, await cifrarArquivo(chave, nome, corpo));
    return nome;
  }

  // Junta uma alteração deste celular (ainda não enviada) com uma versão mais nova que chegou de outro aparelho:
  // os campos que o celular mudou ficam com o valor do celular; os outros ficam com o que chegou.
  const estavel = (v) => v === undefined ? 'u' : (v === null || typeof v !== 'object') ? JSON.stringify(v)
    : Array.isArray(v) ? '[' + v.map(estavel).join(',') + ']' : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + estavel(v[k])).join(',') + '}';
  function juntarComRemoto(meu, base, remoto) {
    if (!remoto) return meu;
    const r = { ...remoto };
    const chaves = new Set([...Object.keys(meu || {}), ...Object.keys(base || {})]);
    for (const k of chaves) {
      if (k === CAMPO_CARIMBO) continue;
      if (estavel((meu || {})[k]) !== estavel((base || {})[k])) { if ((meu || {})[k] === undefined) delete r[k]; else r[k] = meu[k]; }
    }
    return r;
  }

  // conteúdo de um arquivo anexado (foto, PDF...) — baixado só quando a pessoa abre
  async function lerAnexo(chave, transporte, id, campo) {
    const nome = `anexo_${id}_${campo}.sgsync`;
    const arq = await transporte.ler(nome);
    return arq ? dtxt.decode(await decifrarArquivo(chave, nome, arq)) : null;
  }

  // peça fixa enviada pelo notebook (ex.: 'documentos' = aparência dos documentos avulsos); pega a versão mais nova
  async function lerRecurso(chave, transporte, nomeRecurso, jaTenho) {
    const nomes = (await transporte.listar()).filter((n) => n.startsWith(`recurso_${nomeRecurso}_`) && n.endsWith('.sgsync')).sort();
    const nome = nomes[nomes.length - 1];
    if (!nome) return null;
    if (jaTenho && jaTenho === nome) return { nome, conteudo: null };   // já está guardado no aparelho
    const arq = await transporte.ler(nome);
    return arq ? { nome, conteudo: dtxt.decode(await decifrarArquivo(chave, nome, arq)) } : null;
  }

  // senha: o mesmo PBKDF2 do notebook (210 mil voltas + sal) — confere sem precisar de internet
  async function conferirSenha(usuario, senha) {
    if (!usuario || !usuario.senhaHash || !usuario.salt || usuario.algoritmo !== 'pbkdf2') return false;
    const k = await sutil.importKey('raw', txt.encode(String(senha)), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await sutil.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: txt.encode(usuario.salt), iterations: usuario.iteracoes || 210000 }, k, 256));
    const hex = [...bits].map((b) => b.toString(16).padStart(2, '0')).join('');
    return hex === usuario.senhaHash;
  }

  const api = { ARQ_CABECALHO, GAVETAS, CAMPO_CARIMBO, codigoValido, normalizarCodigo, scrypt, abrirCadeado, novoEstado, lerNovidades, montarGavetas, lerAnexo, lerRecurso, conferirSenha,
    enviarLote, juntarComRemoto, sorteio };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else raiz.SgoNucleo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
