# Extrator de Contatos RDS

Aplicação local para extrair contatos das vendas da Reino da Sorte usando uma sessão autenticada no painel oficial.

## Estado
Versão inicial em preparação. A ferramenta deve operar em modo somente leitura, listar os sorteios disponíveis, permitir selecionar sorteios e vendedores, percorrer lotes e páginas, deduplicar por telefone e exportar contatos em VCF.

## Segurança
- Não forneça senha, token ou cookies a terceiros.
- O extrator não deve alterar sorteios, bilhetes ou vendas.
- A execução exige uma sessão autorizada do painel oficial.
- A versão só deve ser considerada pronta após teste real de autenticação, listagem e exportação.

## Arquivos
A interface e os arquivos de extensão serão adicionados neste repositório.
