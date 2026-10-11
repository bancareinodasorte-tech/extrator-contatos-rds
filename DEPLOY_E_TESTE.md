# Instalação e teste controlado

Esta versão ainda precisa ser validada contra a sessão e o formato real da API da Reino da Sorte.

## Instalar no Chrome (computador)
1. Abra o repositório e clique em **Code > Download ZIP**, ou baixe o ZIP do repositório.
2. Extraia a pasta em um local fixo.
3. No Chrome, abra `chrome://extensions`.
4. Ative **Modo do desenvolvedor**.
5. Clique **Carregar sem compactação** e selecione a pasta que contém `manifest.json`.
6. Abra https://admin.reinodasorte.com.br/draws e faça login normalmente.
7. Clique no ícone da extensão. Use **Verificar painel conectado** e depois **Carregar sorteios disponíveis**.

## Importante
- Não informe sua senha, token, cookie ou código de autenticação a ninguém.
- A extensão chama a API oficial a partir do navegador e não possui servidor intermediário.
- Esta versão não deve ser considerada aprovada para extrações completas até confirmar que o endpoint de listagem retorna todos os sorteios, que os campos de comprador/telefone/vendedor correspondem ao modelo atual e que a paginação cobre todos os registros.
- A API pode exigir outro cabeçalho de autenticação ou uma rota diferente. Se a conexão falhar, registre apenas a mensagem de erro sem copiar tokens ou dados pessoais.
- Para grandes extrações, mantenha a janela aberta. O navegador pode interromper tarefas longas.
