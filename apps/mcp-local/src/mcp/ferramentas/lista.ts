import { Ferramenta } from '../contexto';
import { agendarPost } from './agendar-post';
import { listarContas } from './listar-contas';
import { listarPostsPendentes } from './listar-posts-pendentes';
import { sincronizarCanais } from './sincronizar-canais';
import { validarPost } from './validar-post';

/**
 * Registro central das ferramentas. Ferramenta nova entra aqui e no README.
 *
 * A ordem importa: e a ordem que o cliente MCP exibe, e vai do panorama ao
 * efeito colateral (listar, conferir, validar, agendar).
 */
export const FERRAMENTAS: Ferramenta[] = [
  listarContas,
  listarPostsPendentes,
  sincronizarCanais,
  validarPost,
  agendarPost,
];
