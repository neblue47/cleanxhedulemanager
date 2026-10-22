# CleanXheduleManager

## Visão Geral

O `CleanXheduleManager` é uma aplicação leve em **Node.js** que disponibiliza uma API HTTP simples para gestão de agendamentos (tarefas, eventos ou qualquer entrada baseada em horários). Utiliza o **SQLite** como motor de armazenamento persistente, facilitando a execução em qualquer plataforma sem necessidade de um servidor de base de dados separado.

O projeto demonstra uma separação clara entre a lógica do servidor (`src/server.js`) e a camada de base de dados (`database/db.js`). Inclui funções utilitárias para:
- Criar e obter uma conexão SQLite
- Fechar a conexão de forma segura
- Remover ficheiros de lock obsoletos
- Operações CRUD básicas para entradas de agendamento (a ser expandido conforme necessário)

## Funcionalidades

- **SQLite sem configuração** – o ficheiro da base de dados é criado automaticamente na raiz do projeto.
- **Encerramento gracioso** – a conexão com a BD é fechada nos sinais `SIGINT`, `SIGTERM` e à saída do processo.
- **Arquitetura modular** – a lógica do servidor e da BD estão isoladas, facilitando testes e futuras extensões.
- **Multiplataforma** – funciona em Windows, macOS e Linux.

## Pré‑requisitos

- **Node.js** >= 18 (versão LTS recomendada)
- **npm** (incluído com o Node)
- **Git** (opcional, para controlo de versão)

## Instalação

```bash
# Clonar o repositório (caso ainda não o tenha feito)
git clone https://github.com/neblue47/cleanxhedulemanager.git
cd cleanxhedulemanager

# Instalar as dependências do Node.js
npm install
```

## Executar a Aplicação

```bash
# Iniciar o servidor (porta padrão 3000)
npm start
```

O servidor ficará disponível em `http://localhost:3000`. Pode verificar se está a funcionar visitando o URL no navegador ou usando `curl`:

```bash
curl http://localhost:3000/health
```

## Estrutura do Projeto

```
cleanxhedulemanager/
│   README.md               # ← Este ficheiro
│   package.json            # Metadados e scripts do npm
│   package-lock.json
│   .gitignore
├── src/
│   └── server.js          # Servidor Express e definição de rotas
└── database/
    └── db.js              # Utilitários de gestão da conexão SQLite
```

## Scripts (definidos no `package.json`)

- `npm start` – Executa `node src/server.js` (modo de produção).
- `npm run dev` – Inicia o servidor com **nodemon** para recarga automática durante o desenvolvimento (se o adicionar).

## Dependências

| Dependência | Finalidade |
|-------------|------------|
| `express` | Framework web minimalista para tratamento de pedidos HTTP. |
| `sqlite3` | Driver SQLite para Node.js, fornece a API de base de dados utilizada em `db.js`. |
| `dotenv` (opcional) | Carrega variáveis de ambiente a partir de um ficheiro `.env` (ex.: caminho da BD, porta). |

## Dicas de Desenvolvimento

- **Variáveis de ambiente** – crie um ficheiro `.env` na raiz do projeto para substituir os valores padrão:
  ```env
  PORT=4000
  DB_PATH=./my-database.db
  ```
  Depois carregue-o em `src/server.js` com `require('dotenv').config();`.
- **Migrações da base de dados** – atualmente o esquema é criado na primeira execução dentro de `db.js`. Para esquemas mais complexos, considere utilizar uma ferramenta de migração como `knex` ou `sequelize`.
- **Testes** – pode criar testes unitários utilizando `jest` ou `mocha`; estes não estão incluídos neste template inicial.

## Contribuir

Contribuições são bem‑vindas! Sinta-se à vontade para abrir issues ou submeter pull requests. Siga estes passos:
1. Faça um fork do repositório.
2. Crie uma branch para a funcionalidade (`git checkout -b feature/nova-funcionalidade`).
3. Faça commits com mensagens claras.
4. Envie a branch e abra um Pull Request.

## Licença

Este projeto está licenciado sob a **Licença MIT** – consulte o ficheiro `LICENSE` para mais detalhes.

---

*Bom código!*
