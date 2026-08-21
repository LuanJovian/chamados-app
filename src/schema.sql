-- ============================================================
-- Schema: Sistema de Chamados de Suporte Técnico (SQLite)
-- ============================================================
-- Este script é aplicado automaticamente pela aplicação na
-- inicialização (ver src/db.js) -- não é necessário rodar
-- nenhum comando manual, nem instalar um servidor de banco.

PRAGMA foreign_keys = ON;

-- SQLite não tem um tipo ENUM nativo; a validade da situação é garantida
-- por CHECK aqui (defesa em profundidade) e pela camada de regras de
-- negócio em chamadosRepository.js.
CREATE TABLE IF NOT EXISTS chamados (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    solicitante         TEXT NOT NULL,
    descricao           TEXT NOT NULL,
    data_abertura       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    situacao            TEXT NOT NULL DEFAULT 'aberto'
                            CHECK (situacao IN ('aberto', 'em_atendimento', 'encerrado')),
    data_encerramento   TEXT,

    CONSTRAINT chk_solicitante_nao_vazio CHECK (trim(solicitante) <> ''),
    CONSTRAINT chk_descricao_nao_vazia   CHECK (trim(descricao) <> '')
);

CREATE TABLE IF NOT EXISTS atendimentos (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    chamado_id          INTEGER NOT NULL REFERENCES chamados(id) ON DELETE CASCADE,
    data_registro       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    atendente           TEXT,
    observacao          TEXT NOT NULL,
    situacao_anterior   TEXT CHECK (situacao_anterior IN ('aberto', 'em_atendimento', 'encerrado')),
    situacao_nova       TEXT CHECK (situacao_nova IN ('aberto', 'em_atendimento', 'encerrado')),

    CONSTRAINT chk_observacao_nao_vazia CHECK (trim(observacao) <> '')
);

CREATE INDEX IF NOT EXISTS idx_chamados_situacao    ON chamados(situacao);
CREATE INDEX IF NOT EXISTS idx_chamados_solicitante ON chamados(solicitante);
CREATE INDEX IF NOT EXISTS idx_chamados_data        ON chamados(data_abertura);
CREATE INDEX IF NOT EXISTS idx_atendimentos_chamado ON atendimentos(chamado_id);
