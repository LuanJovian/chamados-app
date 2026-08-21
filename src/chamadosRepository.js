// src/chamadosRepository.js
// Regras de negócio + acesso a dados relacionados a chamados.
// Persistência em SQLite (via src/db.js), acesso síncrono internamente,
// mas todas as funções aqui continuam expostas como `async` para manter
// a mesma interface usada pelas rotas (server.js).

const db = require('./db');

const SITUACOES_VALIDAS = ['aberto', 'em_atendimento', 'encerrado'];

// Matriz de transições permitidas entre situações.
// Regra de negócio: um chamado ENCERRADO não volta para ABERTO
// automaticamente; só é permitido reabrir através da ação explícita
// "reabrir", que é uma transição própria, nunca implícita.
const TRANSICOES_PERMITIDAS = {
  aberto: ['em_atendimento', 'encerrado'],
  em_atendimento: ['aberto', 'encerrado'],
  encerrado: ['aberto'], // somente via ação explícita de reabertura (ver repository.reabrir)
};

class ErroValidacao extends Error {
  constructor(mensagem, detalhes) {
    super(mensagem);
    this.name = 'ErroValidacao';
    this.status = 422;
    this.detalhes = detalhes;
  }
}

class ErroNaoEncontrado extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroNaoEncontrado';
    this.status = 404;
  }
}

function validarCamposObrigatorios({ solicitante, descricao }) {
  const erros = [];
  if (!solicitante || !String(solicitante).trim()) {
    erros.push('O campo "solicitante" é obrigatório.');
  }
  if (!descricao || !String(descricao).trim()) {
    erros.push('O campo "descricao" é obrigatória.');
  }
  if (erros.length) {
    throw new ErroValidacao('Dados inválidos para o chamado.', erros);
  }
}

function validarSituacao(situacao) {
  if (!SITUACOES_VALIDAS.includes(situacao)) {
    throw new ErroValidacao(
      `Situação inválida: "${situacao}". Situações válidas: ${SITUACOES_VALIDAS.join(', ')}.`,
      { situacoesValidas: SITUACOES_VALIDAS }
    );
  }
}

/** Cadastrar um novo chamado (sempre nasce "aberto"). */
async function criar({ solicitante, descricao }) {
  validarCamposObrigatorios({ solicitante, descricao });

  const solicitanteLimpo = String(solicitante).trim();
  const descricaoLimpa = String(descricao).trim();

  const info = db.run(
    `INSERT INTO chamados (solicitante, descricao, situacao) VALUES (?, ?, 'aberto')`,
    [solicitanteLimpo, descricaoLimpa]
  );
  return db.get('SELECT * FROM chamados WHERE id = ?', [info.lastInsertRowid]);
}

/** Consultar todos os chamados, com filtros opcionais (usado também para localizar). */
async function listar({ situacao, solicitante, id, termo } = {}) {
  const condicoes = [];
  const params = [];

  if (id !== undefined && id !== null && id !== '') {
    condicoes.push('id = ?');
    params.push(id);
  }
  if (situacao) {
    validarSituacao(situacao);
    condicoes.push('situacao = ?');
    params.push(situacao);
  }
  if (solicitante) {
    condicoes.push('LOWER(solicitante) LIKE LOWER(?)');
    params.push(`%${solicitante}%`);
  }
  if (termo) {
    condicoes.push('(LOWER(descricao) LIKE LOWER(?) OR LOWER(solicitante) LIKE LOWER(?))');
    params.push(`%${termo}%`, `%${termo}%`);
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  return db.all(`SELECT * FROM chamados ${where} ORDER BY id DESC`, params);
}

/** Localizar um chamado específico pelo identificador (consulta pontual). */
async function buscarPorId(id) {
  const chamado = buscarChamadoBruto(id);
  const atendimentos = listarAtendimentos(chamado.id);
  return { ...chamado, atendimentos };
}

/** Registrar uma informação/andamento de atendimento (sem alterar situação). */
async function registrarAtendimento(chamadoId, { atendente, observacao }) {
  const chamado = buscarChamadoBruto(chamadoId);

  if (!observacao || !String(observacao).trim()) {
    throw new ErroValidacao('O campo "observacao" é obrigatório para registrar o atendimento.');
  }

  const info = db.run(
    `INSERT INTO atendimentos (chamado_id, atendente, observacao, situacao_anterior, situacao_nova)
     VALUES (?, ?, ?, ?, ?)`,
    [chamado.id, atendente ? String(atendente).trim() : null, String(observacao).trim(), chamado.situacao, chamado.situacao]
  );
  return db.get('SELECT * FROM atendimentos WHERE id = ?', [info.lastInsertRowid]);
}

/**
 * Alterar a situação de um chamado, validando a transição de estado.
 * Para reabrir um chamado encerrado, o cliente deve enviar explicitamente
 * situacaoNova = 'aberto' — aceito por já estar modelado na matriz de
 * transições como uma ação distinta e intencional (nunca implícita).
 */
async function alterarSituacao(chamadoId, { situacaoNova, atendente, observacao }) {
  validarSituacao(situacaoNova);
  const chamado = buscarChamadoBruto(chamadoId);

  const permitido = TRANSICOES_PERMITIDAS[chamado.situacao] || [];
  if (chamado.situacao === situacaoNova) {
    throw new ErroValidacao(`O chamado #${chamado.id} já está na situação "${situacaoNova}".`);
  }
  if (!permitido.includes(situacaoNova)) {
    throw new ErroValidacao(
      `Transição inválida: não é possível mudar o chamado #${chamado.id} de "${chamado.situacao}" para "${situacaoNova}".`,
      { situacaoAtual: chamado.situacao, transicoesPermitidas: permitido }
    );
  }

  return db.transacao(() => {
    const encerrando = situacaoNova === 'encerrado';
    const reabrindo = chamado.situacao === 'encerrado' && situacaoNova === 'aberto';

    const dataEncerramento = encerrando
      ? new Date().toISOString()
      : reabrindo
        ? null
        : chamado.data_encerramento;

    db.run('UPDATE chamados SET situacao = ?, data_encerramento = ? WHERE id = ?', [
      situacaoNova,
      dataEncerramento,
      chamado.id,
    ]);

    const nota = observacao && observacao.trim()
      ? observacao.trim()
      : `Situação alterada de "${chamado.situacao}" para "${situacaoNova}".`;

    db.run(
      `INSERT INTO atendimentos (chamado_id, atendente, observacao, situacao_anterior, situacao_nova)
       VALUES (?, ?, ?, ?, ?)`,
      [chamado.id, atendente ? atendente.trim() : null, nota, chamado.situacao, situacaoNova]
    );

    return db.get('SELECT * FROM chamados WHERE id = ?', [chamado.id]);
  });
}

/** Encerrar um chamado (atalho semântico sobre alterarSituacao). */
async function encerrar(chamadoId, { atendente, observacao } = {}) {
  return alterarSituacao(chamadoId, { situacaoNova: 'encerrado', atendente, observacao });
}

/** Reabrir explicitamente um chamado encerrado (operação válida e intencional). */
async function reabrir(chamadoId, { atendente, observacao } = {}) {
  return alterarSituacao(chamadoId, { situacaoNova: 'aberto', atendente, observacao });
}

function listarAtendimentos(chamadoId) {
  return db.all('SELECT * FROM atendimentos WHERE chamado_id = ? ORDER BY data_registro ASC', [chamadoId]);
}

function buscarChamadoBruto(id) {
  if (!id || isNaN(Number(id))) {
    throw new ErroValidacao('Identificador de chamado inválido.');
  }
  const chamado = db.get('SELECT * FROM chamados WHERE id = ?', [id]);
  if (!chamado) {
    throw new ErroNaoEncontrado(`Chamado #${id} não encontrado.`);
  }
  return chamado;
}

module.exports = {
  SITUACOES_VALIDAS,
  criar,
  listar,
  buscarPorId,
  registrarAtendimento,
  alterarSituacao,
  encerrar,
  reabrir,
  ErroValidacao,
  ErroNaoEncontrado,
};
