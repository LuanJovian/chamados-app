// src/db.js
// Persistência em ARQUIVO (JSON local), usando apenas o módulo `fs`
// nativo do Node — nenhuma dependência de módulo nativo/binário
// compilado. Isso evita qualquer problema de compatibilidade de
// SO/arquitetura (o motivo desta escolha: bancos como SQLite via
// binário nativo podem falhar de forma imprevisível em computadores
// de laboratório sem permissão para instalar runtimes do sistema).
//
// Estratégia: todo o estado (chamados + atendimentos) é mantido em
// memória e persistido em disco a cada escrita, de forma atômica
// (grava em arquivo temporário e troca o nome só depois de concluído,
// para nunca deixar o arquivo principal corrompido pela metade).

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data');
const TMP_FILE = `${DATA_FILE}.tmp`;

let estado = null; // { proximoIdChamado, proximoIdAtendimento, chamados: [], atendimentos: [] }

function estadoInicial() {
  return {
    proximoIdChamado: 1,
    proximoIdAtendimento: 1,
    chamados: [],
    atendimentos: [],
  };
}

/**
 * Carrega o arquivo de dados na memória (criando-o se ainda não existir).
 * Qualquer problema de acesso ao arquivo/pasta (permissão negada, disco
 * cheio, caminho inválido, JSON corrompido etc.) é tratado aqui: o
 * servidor continua de pé, mas toda operação de dados vai reportar
 * "armazenamento indisponível" até o problema ser corrigido.
 */
function inicializar() {
  try {
    const pasta = path.dirname(DATA_FILE);
    if (!fs.existsSync(pasta)) {
      fs.mkdirSync(pasta, { recursive: true });
    }

    if (fs.existsSync(DATA_FILE)) {
      const bruto = fs.readFileSync(DATA_FILE, 'utf8');
      estado = bruto.trim() ? JSON.parse(bruto) : estadoInicial();
    } else {
      estado = estadoInicial();
      persistir();
    }

    console.log(`[db] Armazenamento em arquivo pronto em: ${DATA_FILE}`);
  } catch (err) {
    console.error('[db] Falha ao abrir/inicializar o arquivo de dados:', err.message);
    estado = null;
  }
}

inicializar();

function garantirDisponivel() {
  if (!estado) {
    const err = new Error('Recurso de armazenamento indisponível no momento.');
    err.storageUnavailable = true;
    throw err;
  }
}

/** Grava o estado atual no arquivo, de forma atômica. */
function persistir() {
  try {
    fs.writeFileSync(TMP_FILE, JSON.stringify(estado, null, 2), 'utf8');
    fs.renameSync(TMP_FILE, DATA_FILE);
  } catch (err) {
    throw tratarErro(err);
  }
}

function tratarErro(err) {
  const codigosArmazenamento = ['EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'ENOENT', 'EIO'];
  if (err && codigosArmazenamento.includes(err.code)) {
    const storageErr = new Error('Recurso de armazenamento indisponível no momento.');
    storageErr.storageUnavailable = true;
    storageErr.cause = err;
    return storageErr;
  }
  return err;
}

/**
 * Executa `fn` recebendo o estado atual (mutável) e, se `fn` não lançar
 * erro, persiste o resultado em disco. Usado para toda operação de
 * escrita (criar chamado, mudar situação, registrar atendimento) —
 * garante que a leitura, a mutação e a gravação aconteçam de forma
 * consistente, já que o Node roda essas chamadas de forma síncrona
 * e single-threaded.
 */
function escrever(fn) {
  garantirDisponivel();
  const resultado = fn(estado);
  persistir();
  return resultado;
}

/** Leitura simples do estado atual, sem gravar nada. */
function ler(fn) {
  garantirDisponivel();
  return fn(estado);
}

function checkConnection() {
  garantirDisponivel();
}

module.exports = { escrever, ler, checkConnection };
