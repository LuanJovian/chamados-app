# Chamados de Suporte Técnico

Aplicação web (HTML + CSS + JavaScript vanilla no front-end, Node.js/Express
no back-end) para registro de chamados de suporte técnico, com persistência
em **SQLite** — um único arquivo local, sem necessidade de instalar,
configurar ou logar em nenhum servidor de banco de dados. Ideal para rodar
em qualquer máquina, inclusive computadores de laboratório/curso onde você
não tem acesso administrativo.

## Organização do projeto

```
chamados-app/
├── package.json
├── .env.example          # opcional: porta e caminho do arquivo do banco
├── src/
│   ├── schema.sql              # DDL: tabelas e constraints (aplicado automaticamente)
│   ├── db.js                   # abre/cria o arquivo SQLite + trata indisponibilidade
│   ├── chamadosRepository.js   # regras de negócio + acesso a dados
│   └── server.js               # API REST (Express)
├── data/
│   └── chamados.db             # criado automaticamente na primeira execução
└── public/                     # front-end estático servido pelo Express
    ├── index.html
    ├── css/style.css
    └── js/app.js               # todo o front-end é JS vanilla (fetch para a API)
```

Arquitetura em camadas simples:
`public/js/app.js (UI)` → `HTTP/JSON` → `server.js (rotas)` → `chamadosRepository.js (regras)` → `db.js (SQLite)`

## Por que SQLite

- Não exige instalar PostgreSQL/MySQL nem saber usuário/senha de nenhum
  servidor — o "banco" é apenas o arquivo `data/chamados.db`.
- A aplicação cria o arquivo e as tabelas sozinha, na primeira vez que
  o servidor sobe (não é preciso rodar nenhum script manualmente).
- Funciona igual em qualquer sistema operacional e não depende de rede.
- Para apagar todos os dados e começar do zero, basta apagar a pasta `data/`.

## Modelo de dados

**`chamados`**: id, solicitante, descricao, data_abertura, situacao
(restrita por `CHECK` a `aberto | em_atendimento | encerrado`),
data_encerramento. Constraints `CHECK` garantem, também no banco, que
solicitante e descrição nunca fiquem vazios.

**`atendimentos`**: histórico de cada informação/andamento registrado em um
chamado (quem atendeu, observação, situação anterior/nova, quando).

## Regras de negócio implementadas

- Solicitante e descrição são obrigatórios (validado na API **e** no banco).
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
- Se o arquivo do banco não puder ser aberto/gravado (pasta sem permissão,
  disco cheio, caminho inválido etc.), a API responde `503` com uma mensagem
  clara (`armazenamento_indisponivel`), e o front-end exibe um banner de
  aviso — a aplicação não quebra nem mostra erro genérico.

## Como executar

Pré-requisito: apenas Node.js 18+ (nada de banco de dados para instalar).

```bash
# 1. Instalar dependências
npm install

# 2. (opcional) configurar porta/caminho do banco
cp .env.example .env

# 3. Subir a aplicação — o banco é criado sozinho na primeira execução
npm start
# Acesse http://localhost:3000
```

Se `npm install` falhar ao instalar `better-sqlite3` por falta de
ferramentas de compilação no computador do laboratório, tente:
```bash
npm install better-sqlite3 --build-from-source=false
```
(o pacote já baixa binários pré-compilados para Windows/Mac/Linux na
maioria dos casos, então isso raramente é necessário).

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
inicialização do zero (sem nenhum arquivo de banco pré-existente):
1. O arquivo `data/chamados.db` e as tabelas são criados automaticamente
   ao rodar `npm start` pela primeira vez.
2. Criação de chamado válido e rejeição de dados inválidos (sem descrição /
   sem solicitante) — HTTP 422.
3. Consulta geral, por identificador, por texto e chamado inexistente —
   HTTP 404.
4. Alteração de situação válida, situação inexistente no domínio (HTTP 422)
   e transição inválida a partir de "encerrado" (HTTP 422).
5. Encerramento e reabertura explícita.
6. Simulação de armazenamento indisponível (banco apontando para um
   caminho inacessível) — a API respondeu HTTP 503 de forma controlada,
   sem derrubar o servidor Node.
