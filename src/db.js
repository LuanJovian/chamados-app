// src/db.js
// Persistência em SQLite: um único arquivo local, sem necessidade de
// instalar/configurar um servidor de banco de dados nem lidar com
// usuário/senha. Ideal para rodar em qualquer computador (inclusive
// os de laboratório/curso, sem permissões administrativas).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'chamados.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db;

/**
 * Abre (ou cria) o arquivo de banco e aplica o schema.
 * Qualquer problema de acesso ao arquivo (pasta sem permissão de
 * escrita, disco cheio, caminho inválido etc.) é tratado aqui como
 * "armazenamento indisponível", sem derrubar o processo.
 */
function conectar() {
  try {
    const pasta = path.dirname(DB_PATH);
    if (!fs.existsSync(pasta)) {
      fs.mkdirSync(pasta, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');   // melhora concorrência leitura/escrita em arquivo
    db.pragma('foreign_keys = ON');

    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);

    console.log(`[db] Banco SQLite pronto em: ${DB_PATH}`);
  } catch (err) {
    console.error('[db] Falha ao abrir/inicializar o banco SQLite:', err.message);
    db = null; // toda query subsequente vai reportar "indisponível"
  }
}

conectar();

/**
 * Códigos típicos de indisponibilidade do arquivo de banco no SQLite:
 * banco ocupado por outro processo, disco cheio, arquivo bloqueado/corrompido,
 * sem permissão de escrita, ou o banco nem chegou a abrir na inicialização.
 */
function isStorageError(err) {
  const codigos = [
    'SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_IOERR', 'SQLITE_CANTOPEN',
    'SQLITE_CORRUPT', 'SQLITE_READONLY', 'SQLITE_FULL', 'SQLITE_NOTADB',
    'SQLITE_PROTOCOL', 'SQLITE_PERM',
  ];
  return !!(err && err.code && codigos.includes(err.code));
}

function garantirConexao() {
  if (!db) {
    const err = new Error('Recurso de armazenamento indisponível no momento.');
    err.storageUnavailable = true;
    throw err;
  }
}

/** SELECT que retorna várias linhas. */
function all(sql, params = []) {
  garantirConexao();
  try {
    return db.prepare(sql).all(...params);
  } catch (err) {
    throw tratarErro(err);
  }
}

/** SELECT que retorna uma única linha (ou undefined). */
function get(sql, params = []) {
  garantirConexao();
  try {
    return db.prepare(sql).get(...params);
  } catch (err) {
    throw tratarErro(err);
  }
}

/** INSERT/UPDATE/DELETE. Retorna { lastInsertRowid, changes }. */
function run(sql, params = []) {
  garantirConexao();
  try {
    return db.prepare(sql).run(...params);
  } catch (err) {
    throw tratarErro(err);
  }
}

/** Executa uma função dentro de uma transação SQLite. */
function transacao(fn) {
  garantirConexao();
  try {
    return db.transaction(fn)();
  } catch (err) {
    throw tratarErro(err);
  }
}

function tratarErro(err) {
  if (isStorageError(err)) {
    const storageErr = new Error('Recurso de armazenamento indisponível no momento.');
    storageErr.storageUnavailable = true;
    storageErr.cause = err;
    return storageErr;
  }
  return err;
}

function checkConnection() {
  garantirConexao();
  db.prepare('SELECT 1').get();
}

module.exports = { all, get, run, transacao, checkConnection };
