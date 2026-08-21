// public/js/app.js
// Frontend em JavaScript vanilla. Toda a comunicação com o backend
// acontece via fetch() para a API REST em /api/chamados.

const API_BASE = '/api';

const ROTULOS_SITUACAO = {
  aberto: 'Aberto',
  em_atendimento: 'Em atendimento',
  encerrado: 'Encerrado',
};

// -------------------- Referências de elementos --------------------
const bannerOffline = document.getElementById('banner-offline');
const listaChamadosEl = document.getElementById('lista-chamados');

const formNovoChamado = document.getElementById('form-novo-chamado');
const erroNovoChamadoEl = document.getElementById('erro-novo-chamado');

const formBusca = document.getElementById('form-busca');
const btnLimparBusca = document.getElementById('btn-limpar-busca');
const btnAtualizar = document.getElementById('btn-atualizar');

const modalOverlay = document.getElementById('modal-overlay');
const modalConteudo = document.getElementById('modal-conteudo');
const modalFechar = document.getElementById('modal-fechar');

// -------------------- Camada de acesso à API --------------------

/**
 * Wrapper de fetch que centraliza o tratamento de erros da API,
 * incluindo o caso de o armazenamento (banco) estar indisponível (HTTP 503).
 */
async function apiFetch(caminho, opcoes = {}) {
  let resposta;
  try {
    resposta = await fetch(`${API_BASE}${caminho}`, {
      headers: { 'Content-Type': 'application/json' },
      ...opcoes,
    });
  } catch (erroRede) {
    // Falha de rede: o próprio servidor Node pode estar fora do ar.
    mostrarBannerOffline(true);
    throw new ErroApi('Não foi possível conectar ao servidor. Verifique sua conexão.', 0);
  }

  let corpo = null;
  try {
    corpo = await resposta.json();
  } catch (_) {
    // resposta sem corpo JSON (ex.: 204) -- ok
  }

  if (resposta.status === 503) {
    mostrarBannerOffline(true);
    throw new ErroApi(corpo?.mensagem || 'Armazenamento indisponível.', 503, corpo);
  }

  mostrarBannerOffline(false);

  if (!resposta.ok) {
    throw new ErroApi(corpo?.mensagem || 'Erro ao processar a requisição.', resposta.status, corpo);
  }

  return corpo;
}

class ErroApi extends Error {
  constructor(mensagem, status, corpo) {
    super(mensagem);
    this.status = status;
    this.corpo = corpo;
  }
}

function mostrarBannerOffline(mostrar) {
  bannerOffline.classList.toggle('hidden', !mostrar);
}

const api = {
  health: () => apiFetch('/health'),
  criarChamado: (dados) => apiFetch('/chamados', { method: 'POST', body: JSON.stringify(dados) }),
  listarChamados: (filtros = {}) => {
    const params = new URLSearchParams();
    Object.entries(filtros).forEach(([chave, valor]) => {
      if (valor !== undefined && valor !== null && valor !== '') params.append(chave, valor);
    });
    const qs = params.toString();
    return apiFetch(`/chamados${qs ? `?${qs}` : ''}`);
  },
  buscarChamado: (id) => apiFetch(`/chamados/${id}`),
  registrarAtendimento: (id, dados) =>
    apiFetch(`/chamados/${id}/atendimentos`, { method: 'POST', body: JSON.stringify(dados) }),
  alterarSituacao: (id, dados) =>
    apiFetch(`/chamados/${id}/situacao`, { method: 'PATCH', body: JSON.stringify(dados) }),
  encerrar: (id, dados) => apiFetch(`/chamados/${id}/encerrar`, { method: 'POST', body: JSON.stringify(dados) }),
  reabrir: (id, dados) => apiFetch(`/chamados/${id}/reabrir`, { method: 'POST', body: JSON.stringify(dados) }),
};

// -------------------- Estado local simples --------------------
let filtroAtual = {};

// -------------------- Renderização da lista --------------------

function formatarData(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function badgeSituacao(situacao) {
  return `<span class="badge badge-${situacao}">${ROTULOS_SITUACAO[situacao] || situacao}</span>`;
}

function renderizarLista(chamados) {
  if (!chamados.length) {
    listaChamadosEl.innerHTML = '<p class="vazio">Nenhum chamado encontrado.</p>';
    return;
  }

  listaChamadosEl.innerHTML = chamados
    .map(
      (c) => `
      <div class="chamado-item" data-id="${c.id}">
        <div class="chamado-info">
          <div class="chamado-titulo">
            <span class="chamado-id">#${c.id}</span>
            <span class="chamado-solicitante">${escapeHtml(c.solicitante)}</span>
            ${badgeSituacao(c.situacao)}
          </div>
          <div class="chamado-descricao">${escapeHtml(c.descricao)}</div>
          <div class="chamado-data">Aberto em ${formatarData(c.data_abertura)}${
        c.data_encerramento ? ` · Encerrado em ${formatarData(c.data_encerramento)}` : ''
      }</div>
        </div>
      </div>`
    )
    .join('');

  listaChamadosEl.querySelectorAll('.chamado-item').forEach((el) => {
    el.addEventListener('click', () => abrirDetalhes(el.dataset.id));
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

async function carregarLista() {
  listaChamadosEl.innerHTML = '<p class="vazio">Carregando chamados...</p>';
  try {
    const chamados = await api.listarChamados(filtroAtual);
    renderizarLista(chamados);
  } catch (erro) {
    listaChamadosEl.innerHTML = `<p class="vazio">Não foi possível carregar os chamados agora.${
      erro.status === 503 ? ' O armazenamento está indisponível.' : ''
    }</p>`;
  }
}

// -------------------- Cadastro de chamado --------------------

formNovoChamado.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  erroNovoChamadoEl.classList.add('hidden');

  const solicitante = document.getElementById('solicitante').value;
  const descricao = document.getElementById('descricao').value;

  const btn = formNovoChamado.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const chamado = await api.criarChamado({ solicitante, descricao });
    formNovoChamado.reset();
    await carregarLista();
    mostrarMensagemTemporaria(`Chamado #${chamado.id} cadastrado com sucesso.`);
  } catch (erro) {
    exibirErroFormulario(erroNovoChamadoEl, erro);
  } finally {
    btn.disabled = false;
  }
});

function exibirErroFormulario(container, erro) {
  const linhas = erro.corpo?.detalhes && Array.isArray(erro.corpo.detalhes)
    ? erro.corpo.detalhes
    : [erro.message];
  container.textContent = linhas.join('\n');
  container.classList.remove('hidden');
}

function mostrarMensagemTemporaria(texto) {
  const div = document.createElement('div');
  div.className = 'mensagem-sucesso';
  div.textContent = texto;
  formNovoChamado.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

// -------------------- Busca / localização --------------------

formBusca.addEventListener('submit', (ev) => {
  ev.preventDefault();
  filtroAtual = {
    id: document.getElementById('busca-id').value.trim(),
    termo: document.getElementById('busca-termo').value.trim(),
    situacao: document.getElementById('busca-situacao').value,
  };
  carregarLista();
});

btnLimparBusca.addEventListener('click', () => {
  formBusca.reset();
  filtroAtual = {};
  carregarLista();
});

btnAtualizar.addEventListener('click', carregarLista);

// -------------------- Modal de detalhes / ações --------------------

async function abrirDetalhes(id) {
  modalConteudo.innerHTML = '<p class="vazio">Carregando...</p>';
  modalOverlay.classList.remove('hidden');
  try {
    const chamado = await api.buscarChamado(id);
    renderizarModal(chamado);
  } catch (erro) {
    modalConteudo.innerHTML = `<p class="mensagem-erro">${escapeHtml(erro.message)}</p>`;
  }
}

function fecharModal() {
  modalOverlay.classList.add('hidden');
  modalConteudo.innerHTML = '';
}
modalFechar.addEventListener('click', fecharModal);
modalOverlay.addEventListener('click', (ev) => {
  if (ev.target === modalOverlay) fecharModal();
});

// Transições permitidas a partir de cada situação (espelha o backend, só para orientar a UI;
// a validação de verdade acontece sempre no servidor).
const TRANSICOES_UI = {
  aberto: ['em_atendimento', 'encerrado'],
  em_atendimento: ['aberto', 'encerrado'],
  encerrado: ['aberto'],
};

function renderizarModal(chamado) {
  const transicoes = TRANSICOES_UI[chamado.situacao] || [];

  modalConteudo.innerHTML = `
    <h3>Chamado #${chamado.id}</h3>
    <div class="detalhe-linha"><strong>Solicitante:</strong> ${escapeHtml(chamado.solicitante)}</div>
    <div class="detalhe-linha"><strong>Descrição:</strong> ${escapeHtml(chamado.descricao)}</div>
    <div class="detalhe-linha"><strong>Situação:</strong> ${badgeSituacao(chamado.situacao)}</div>
    <div class="detalhe-linha"><strong>Aberto em:</strong> ${formatarData(chamado.data_abertura)}</div>
    ${chamado.data_encerramento ? `<div class="detalhe-linha"><strong>Encerrado em:</strong> ${formatarData(chamado.data_encerramento)}</div>` : ''}

    <div class="transicoes">
      ${transicoes
        .map(
          (sit) =>
            `<button class="btn btn-secundario btn-transicao" data-situacao="${sit}">
               ${sit === 'aberto' && chamado.situacao === 'encerrado' ? 'Reabrir chamado' : `Mover para "${ROTULOS_SITUACAO[sit]}"`}
             </button>`
        )
        .join('')}
      ${!transicoes.length ? '<span class="vazio">Nenhuma transição disponível.</span>' : ''}
    </div>
    <div id="erro-transicao" class="mensagem-erro hidden"></div>

    <div class="form-atendimento">
      <h4>Registrar informação de atendimento</h4>
      <form id="form-atendimento">
        <div class="campo">
          <label for="atendente">Atendente</label>
          <input type="text" id="atendente" placeholder="Nome do atendente (opcional)" />
        </div>
        <div class="campo">
          <label for="observacao">Observação *</label>
          <textarea id="observacao" rows="2" placeholder="Descreva a ação realizada no atendimento"></textarea>
        </div>
        <button type="submit" class="btn btn-primario">Registrar atendimento</button>
      </form>
      <div id="erro-atendimento" class="mensagem-erro hidden"></div>
    </div>

    <div class="historico">
      <h4>Histórico de atendimento</h4>
      ${
        chamado.atendimentos && chamado.atendimentos.length
          ? chamado.atendimentos
              .map(
                (a) => `
              <div class="historico-item">
                ${escapeHtml(a.observacao)}
                <div class="meta">
                  ${a.atendente ? `Por ${escapeHtml(a.atendente)} · ` : ''}${formatarData(a.data_registro)}
                  ${a.situacao_anterior !== a.situacao_nova ? ` · ${ROTULOS_SITUACAO[a.situacao_anterior] || a.situacao_anterior} → ${ROTULOS_SITUACAO[a.situacao_nova] || a.situacao_nova}` : ''}
                </div>
              </div>`
              )
              .join('')
          : '<p class="vazio">Nenhum atendimento registrado ainda.</p>'
      }
    </div>
  `;

  modalConteudo.querySelectorAll('.btn-transicao').forEach((btn) => {
    btn.addEventListener('click', () => alterarSituacaoModal(chamado.id, btn.dataset.situacao));
  });

  const formAtendimento = modalConteudo.querySelector('#form-atendimento');
  formAtendimento.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = modalConteudo.querySelector('#erro-atendimento');
    erroEl.classList.add('hidden');
    const atendente = modalConteudo.querySelector('#atendente').value;
    const observacao = modalConteudo.querySelector('#observacao').value;
    try {
      await api.registrarAtendimento(chamado.id, { atendente, observacao });
      const atualizado = await api.buscarChamado(chamado.id);
      renderizarModal(atualizado);
      await carregarLista();
    } catch (erro) {
      exibirErroFormulario(erroEl, erro);
    }
  });
}

async function alterarSituacaoModal(id, situacaoNova) {
  const erroEl = modalConteudo.querySelector('#erro-transicao');
  erroEl.classList.add('hidden');
  try {
    await api.alterarSituacao(id, { situacao: situacaoNova });
    const atualizado = await api.buscarChamado(id);
    renderizarModal(atualizado);
    await carregarLista();
  } catch (erro) {
    exibirErroFormulario(erroEl, erro);
  }
}

// -------------------- Inicialização --------------------

async function inicializar() {
  try {
    await api.health();
    mostrarBannerOffline(false);
  } catch (_) {
    // apiFetch já exibe o banner
  }
  carregarLista();
}

inicializar();
