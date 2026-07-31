#!/usr/bin/env node
import { iniciarServidor } from './mcp/servidor';

/**
 * Entrypoint do servidor MCP local (transporte stdio).
 *
 * REGRA DE OURO: nada pode ser escrito em `stdout` alem do protocolo MCP.
 * Um unico `console.log` corrompe a sessao e o cliente desconecta sem
 * explicacao. Todo diagnostico vai para `stderr`.
 */
iniciarServidor().catch((erro: unknown) => {
  process.stderr.write(
    `[robo-multipost-local] falha ao iniciar: ${
      (erro as Error)?.stack ?? String(erro)
    }\n`
  );
  process.exit(1);
});
