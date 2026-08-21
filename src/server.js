// src/server.js
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const repo = require('./chamadosRepository');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Helper para não repetir try/catch em toda rota.
const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// -------------------- Rotas da API --------------------

// Healthcheck: também serve para a UI avisar o usuário se o banco caiu.
app.get('/api/health', asyncHandler(async (req, res) => {
  await db.checkConnection();
  res.json({ status: 'ok' });
}));

// Cadastrar chamado
app.post('/api/chamados', asyncHandler(async (req, res) => {
  const { solicitante, descricao } = req.body || {};
  const chamado = await repo.criar({ solicitante, descricao });
  res.status(201).json(chamado);
}));

// Consultar / localizar chamados (com filtros: id, situacao, solicitante, termo)
app.get('/api/chamados', asyncHandler(async (req, res) => {
  const { situacao, solicitante, id, termo } = req.query;
  const chamados = await repo.listar({ situacao, solicitante, id, termo });
  res.json(chamados);
}));

// Consultar um chamado específico pelo identificador (inclui histórico de atendimento)
app.get('/api/chamados/:id', asyncHandler(async (req, res) => {
  const chamado = await repo.buscarPorId(req.params.id);
  res.json(chamado);
}));

// Registrar informação de atendimento (não muda a situação)
app.post('/api/chamados/:id/atendimentos', asyncHandler(async (req, res) => {
  const { atendente, observacao } = req.body || {};
  const registro = await repo.registrarAtendimento(req.params.id, { atendente, observacao });
  res.status(201).json(registro);
}));

// Alterar situação (genérico, valida transição de estado)
app.patch('/api/chamados/:id/situacao', asyncHandler(async (req, res) => {
  const { situacao, atendente, observacao } = req.body || {};
  const chamado = await repo.alterarSituacao(req.params.id, {
    situacaoNova: situacao,
    atendente,
    observacao,
  });
  res.json(chamado);
}));

// Encerrar chamado (atalho semântico)
app.post('/api/chamados/:id/encerrar', asyncHandler(async (req, res) => {
  const { atendente, observacao } = req.body || {};
  const chamado = await repo.encerrar(req.params.id, { atendente, observacao });
  res.json(chamado);
}));

// Reabrir chamado encerrado (operação explícita e válida)
app.post('/api/chamados/:id/reabrir', asyncHandler(async (req, res) => {
  const { atendente, observacao } = req.body || {};
  const chamado = await repo.reabrir(req.params.id, { atendente, observacao });
  res.json(chamado);
}));

// -------------------- Tratamento centralizado de erros --------------------
app.use((err, req, res, next) => {
  if (err.storageUnavailable) {
    console.error('[storage] indisponível:', err.cause?.message || err.message);
    return res.status(503).json({
      erro: 'armazenamento_indisponivel',
      mensagem: 'O recurso de armazenamento (banco de dados) está indisponível no momento. Tente novamente em instantes.',
    });
  }
  if (err.name === 'ErroValidacao') {
    return res.status(err.status).json({ erro: 'validacao', mensagem: err.message, detalhes: err.detalhes });
  }
  if (err.name === 'ErroNaoEncontrado') {
    return res.status(err.status).json({ erro: 'nao_encontrado', mensagem: err.message });
  }
  console.error('[erro_interno]', err);
  res.status(500).json({ erro: 'interno', mensagem: 'Erro interno inesperado.' });
});

app.listen(PORT, () => {
  console.log(`Servidor de chamados rodando em http://localhost:${PORT}`);
});
