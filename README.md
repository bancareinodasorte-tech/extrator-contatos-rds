# Extrator de Contatos RDS

Extensão para Google Chrome que acessa a sessão autenticada no painel oficial, lista sorteios, permite selecionar sorteios e filtrar vendedor, percorre lotes/páginas configurados, remove contatos repetidos pelo telefone e exporta VCF ou CSV.

## Arquivos
- `manifest.json`: permissões e configuração da extensão.
- `popup.html` e `popup.js`: interface, extração e exportação.
- `content.js`: leitura local do token da sessão autenticada do painel.

## Instalação no Chrome para computador
1. Abra **Code > Download ZIP** e extraia o arquivo.
2. Acesse `chrome://extensions`.
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e selecione a pasta que contém `manifest.json`.
5. Abra o painel oficial `https://admin.reinodasorte.com.br/draws` e entre normalmente.
6. Clique no ícone da extensão, depois em **Verificar painel conectado** e **Carregar sorteios disponíveis**.

## Observação importante
A implementação foi enviada ao repositório, mas ainda não foi validada com uma sessão real e com o esquema atual da API. Antes de usar em massa, confirme a listagem, os vendedores, a cobertura completa dos lotes/páginas e a contagem dos contatos. Não envie senha, token, cookie ou dados de compradores por mensagem. A extensão é somente leitura e não deve modificar sorteios ou vendas.