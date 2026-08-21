# Chamados de Suporte Técnico

Aplicação web (HTML + CSS + JavaScript vanilla no front-end, Node.js/Express
no back-end) para registro de chamados de suporte técnico, com persistência
em **arquivo (JSON local)**.

A persistência usa apenas o módulo `fs`, nativo do Node — **nenhuma
dependência de módulo nativo/binário compilado** (ex.: drivers de banco como
`better-sqlite3` ou `pg`). Isso evita problemas de compatibilidade em
computadores de laboratório/curso onde você não tem permissão para instalar
runtimes do sistema (Visual C++ Redistributable, compiladores etc.) ou
acesso a um servidor de banco de dados.

## Organização do projeto

```
chamados-app/
├── package.json
├── .env.example          # opcional: porta e caminho do arquivo de dados
├── src/
│   ├── db.js                   # leitura/gravação atômica do arquivo JSON + trata indisponibilidade
│   ├── chamadosRepository.js   # regras de negócio + acesso a dados
│   └── server.js               # API REST (Express)
├── data/
│   └── chamados.json           # criado automaticamente na primeira execução
└── public/                     # front-end estático servido pelo Express
    ├── index.html
    ├── css/style.css
    └── js/app.js                # todo o front-end é JS vanilla (fetch para a API)
```

Arquitetura em camadas simples:
`public/js/app.js (UI)` → `HTTP/JSON` → `server.js (rotas)` → `chamadosRepository.js (regras)` → `db.js (arquivo JSON)`

## Por que persistência em arquivo

- Não exige instalar nem configurar nenhum banco de dados, servidor,
  usuário ou senha.
- Não depende de nenhum módulo nativo compilado (`.node`/binário) —
  elimina de vez erros de incompatibilidade de SO/arquitetura, que podem
  causar até crashes silenciosos do processo Node em certos ambientes
  Windows restritos.
- A aplicação cria o arquivo sozinha, na primeira vez que o servidor sobe.
- Para apagar todos os dados e começar do zero, basta apagar a pasta `data/`.
- Toda escrita é feita de forma atômica (grava em um arquivo temporário e só
  troca pelo definitivo depois de concluída), para nunca deixar o arquivo
  corrompido pela metade em caso de falha durante a gravação.

## Modelo de dados

O arquivo `data/chamados.json` guarda um único objeto com esta forma:

```json
{
  "proximoIdChamado": 4,
  "proximoIdAtendimento": 5,
  "chamados": [
    {
      "id": 1,
      "solicitante": "Maria Souza",
      "descricao": "Impressora nao liga",
      "data_abertura": "2026-08-21T22:52:55.361Z",
      "situacao": "aberto",
      "data_encerramento": null
    }
  ],
  "atendimentos": [
    {
      "id": 1,
      "chamado_id": 1,
      "data_registro": "2026-08-21T22:52:55.418Z",
      "atendente": "Suporte N1",
      "observacao": "Situação alterada de \"aberto\" para \"em_atendimento\".",
      "situacao_anterior": "aberto",
      "situacao_nova": "em_atendimento"
    }
  ]
}
```

- **`chamados`**: id, solicitante, descrição, data de abertura, situação
  (`aberto | em_atendimento | encerrado`), data de encerramento.
- **`atendimentos`**: histórico de cada informação/andamento registrado em
  um chamado (quem atendeu, observação, situação anterior/nova, quando) —
  inclusive as próprias mudanças de situação viram um registro aqui.

## Regras de negócio implementadas

- Solicitante e descrição são obrigatórios (validado em `chamadosRepository.js`
  antes de qualquer gravação).
- Situação só pode ser uma das três válidas; qualquer outro valor retorna
  `422` com a lista de situações válidas.
- Transições de situação seguem uma máquina de estados explícita:
  - `aberto → em_atendimento | encerrado`
  - `em_atendimento → aberto | encerrado`
  - `encerrado → aberto` **somente** via ação explícita (endpoint
    `POST /chamados/:id/reabrir` ou `PATCH .../situacao` enviando
    `situacao: "aberto"` deliberadamente) — nunca acontece implicitamente.
- Localização de chamados por identificador, situação, solicitante ou texto
  livre na descrição.
- Se o arquivo de dados não puder ser lido/gravado (pasta sem permissão,
  disco cheio, caminho inválido etc.), a API responde `503` com uma mensagem
  clara (`armazenamento_indisponivel`), e o front-end exibe um banner de
  aviso — a aplicação não quebra nem mostra erro genérico.

## Como executar

Pré-requisito: apenas Node.js (qualquer versão razoavelmente recente — foi
testado com Node 18). Nada mais precisa ser instalado no sistema.

```bash
# 1. Instalar dependências
npm install

# 2. (opcional) configurar porta/caminho do arquivo de dados
cp .env.example .env

# 3. Subir a aplicação — o arquivo de dados é criado sozinho na primeira execução
npm start
# Acesse http://localhost:3000
```

## API REST

| Método | Rota                              | Descrição                                   |
|--------|------------------------------------|------------------------------------------------|
| GET    | /api/health                        | Verifica se o armazenamento está acessível      |
| POST   | /api/chamados                      | Cadastrar chamado (`solicitante`, `descricao`)  |
| GET    | /api/chamados                      | Listar/localizar (`?id=`, `?situacao=`, `?solicitante=`, `?termo=`) |
| GET    | /api/chamados/:id                  | Consultar um chamado (com histórico)            |
| POST   | /api/chamados/:id/atendimentos     | Registrar informação de atendimento             |
| PATCH  | /api/chamados/:id/situacao         | Alterar situação (`situacao`, `atendente`, `observacao`) |
| POST   | /api/chamados/:id/encerrar         | Atalho para encerrar                            |
| POST   | /api/chamados/:id/reabrir          | Atalho para reabrir (ação explícita)            |

### Exemplos (curl)

```bash
# Criar
curl -X POST http://localhost:3000/api/chamados -H "Content-Type: application/json" \
  -d '{"solicitante":"Maria Souza","descricao":"Impressora nao liga"}'

# Consultar / localizar
curl http://localhost:3000/api/chamados/1
curl "http://localhost:3000/api/chamados?situacao=aberto"

# Alterar situação
curl -X PATCH http://localhost:3000/api/chamados/1/situacao -H "Content-Type: application/json" \
  -d '{"situacao":"em_atendimento","atendente":"Suporte N1"}'

# Encerrar
curl -X POST http://localhost:3000/api/chamados/1/encerrar -H "Content-Type: application/json" \
  -d '{"observacao":"Peca substituida"}'

# Reabrir (única forma de um chamado encerrado voltar a aberto)
curl -X POST http://localhost:3000/api/chamados/1/reabrir -H "Content-Type: application/json" \
  -d '{"observacao":"Cliente relatou reincidencia"}'
```

## Demonstração já validada

Este projeto foi testado de ponta a ponta, incluindo instalação e
inicialização do zero (sem nenhum arquivo de dados pré-existente):
1. O arquivo `data/chamados.json` é criado automaticamente ao rodar
   `npm start` pela primeira vez.
2. Criação de chamado válido e rejeição de dados inválidos (sem descrição /
   sem solicitante) — HTTP 422.
3. Consulta geral, por identificador, por texto e chamado inexistente —
   HTTP 404.
4. Alteração de situação válida, situação inexistente no domínio (HTTP 422)
   e transição inválida a partir de "encerrado" (HTTP 422).
5. Encerramento e reabertura explícita, com o histórico de atendimentos
   refletido corretamente no arquivo.
6. Simulação de armazenamento indisponível (arquivo apontando para um
   caminho inacessível) — a API respondeu HTTP 503 de forma controlada,
   sem derrubar o servidor Node.
