// src/chamadosRepository.js
// Regras de negócio + acesso a dados relacionados a chamados.
// Persistência em arquivo JSON local (via src/db.js) — as operações
// de filtro/ordenação que antes eram feitas em SQL agora são feitas
// aqui mesmo, em JavaScript puro, sobre os arrays em memória.

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

  return db.escrever((estado) => {
    const chamado = {
      id: estado.proximoIdChamado++,
      solicitante: solicitanteLimpo,
      descricao: descricaoLimpa,
      data_abertura: new Date().toISOString(),
      situacao: 'aberto',
      data_encerramento: null,
    };
    estado.chamados.push(chamado);
    return { ...chamado };
  });
}

/** Consultar todos os chamados, com filtros opcionais (usado também para localizar). */
async function listar({ situacao, solicitante, id, termo } = {}) {
  if (situacao) validarSituacao(situacao);

  return db.ler((estado) => {
    let resultado = estado.chamados;

    if (id !== undefined && id !== null && id !== '') {
      const idNum = Number(id);
      resultado = resultado.filter((c) => c.id === idNum);
    }
    if (situacao) {
      resultado = resultado.filter((c) => c.situacao === situacao);
    }
    if (solicitante) {
      const termoBusca = solicitante.toLowerCase();
      resultado = resultado.filter((c) => c.solicitante.toLowerCase().includes(termoBusca));
    }
    if (termo) {
      const termoBusca = termo.toLowerCase();
      resultado = resultado.filter(
        (c) =>
          c.descricao.toLowerCase().includes(termoBusca) ||
          c.solicitante.toLowerCase().includes(termoBusca)
      );
    }

    return resultado
      .slice()
      .sort((a, b) => b.id - a.id)
      .map((c) => ({ ...c }));
  });
}

/** Localizar um chamado específico pelo identificador (consulta pontual). */
async function buscarPorId(id) {
  const chamado = buscarChamadoBruto(id);
  const atendimentos = listarAtendimentos(chamado.id);
  return { ...chamado, atendimentos };
}

/** Registrar uma informação/andamento de atendimento (sem alterar situação). */
async function registrarAtendimento(chamadoId, { atendente, observacao }) {
  if (!observacao || !String(observacao).trim()) {
    throw new ErroValidacao('O campo "observacao" é obrigatório para registrar o atendimento.');
  }

  return db.escrever((estado) => {
    const chamado = encontrarChamado(estado, chamadoId);
    const registro = {
      id: estado.proximoIdAtendimento++,
      chamado_id: chamado.id,
      data_registro: new Date().toISOString(),
      atendente: atendente ? String(atendente).trim() : null,
      observacao: String(observacao).trim(),
      situacao_anterior: chamado.situacao,
      situacao_nova: chamado.situacao,
    };
    estado.atendimentos.push(registro);
    return { ...registro };
  });
}

/**
 * Alterar a situação de um chamado, validando a transição de estado.
 * Para reabrir um chamado encerrado, o cliente deve enviar explicitamente
 * situacaoNova = 'aberto' — aceito por já estar modelado na matriz de
 * transições como uma ação distinta e intencional (nunca implícita).
 */
async function alterarSituacao(chamadoId, { situacaoNova, atendente, observacao }) {
  validarSituacao(situacaoNova);

  return db.escrever((estado) => {
    const chamado = encontrarChamado(estado, chamadoId);

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

    const situacaoAnterior = chamado.situacao;
    const encerrando = situacaoNova === 'encerrado';
    const reabrindo = situacaoAnterior === 'encerrado' && situacaoNova === 'aberto';

    chamado.situacao = situacaoNova;
    if (encerrando) chamado.data_encerramento = new Date().toISOString();
    else if (reabrindo) chamado.data_encerramento = null;

    const nota = observacao && observacao.trim()
      ? observacao.trim()
      : `Situação alterada de "${situacaoAnterior}" para "${situacaoNova}".`;

    estado.atendimentos.push({
      id: estado.proximoIdAtendimento++,
      chamado_id: chamado.id,
      data_registro: new Date().toISOString(),
      atendente: atendente ? String(atendente).trim() : null,
      observacao: nota,
      situacao_anterior: situacaoAnterior,
      situacao_nova: situacaoNova,
    });

    return { ...chamado };
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
  return db.ler((estado) =>
    estado.atendimentos
      .filter((a) => a.chamado_id === chamadoId)
      .sort((a, b) => new Date(a.data_registro) - new Date(b.data_registro))
      .map((a) => ({ ...a }))
  );
}

function buscarChamadoBruto(id) {
  return db.ler((estado) => ({ ...encontrarChamado(estado, id) }));
}

/** Encontra o chamado dentro do estado já carregado (uso interno). */
function encontrarChamado(estado, id) {
  if (!id || isNaN(Number(id))) {
    throw new ErroValidacao('Identificador de chamado inválido.');
  }
  const idNum = Number(id);
  const chamado = estado.chamados.find((c) => c.id === idNum);
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
