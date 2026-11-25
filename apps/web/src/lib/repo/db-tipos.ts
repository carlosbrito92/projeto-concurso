/**
 * Tipos do esquema `public` (derivados do que o Supabase gera para o projeto; Insert/Update calculados a partir de Row).
 * Regerar quando uma migração mudar o esquema.
 */
export type Json = string | number | boolean | null | { [k: string]: Json | undefined } | Json[];

type Tab<R, Opc extends keyof R = never> = { Row: R; Insert: Omit<R, Opc> & Partial<Pick<R, Opc>>; Update: Partial<R>; Relationships: [] };

export interface Database {
  public: {
    Tables: {
      banca_perfil: Tab<{ banca: string; amostra: Json; medidas: Json; atualizado_em: string }, "atualizado_em">;
      concurso: Tab<{ slug: string; orgao: string; uf: string; area: string; banca: string; cargo: string; edital: string; ano: number; vagas: number | null; total_questoes: number; alternativas: number; pontos_por_questao: number; nota_minima: number | null; data_provavel: string | null; criado_em: string }, "area" | "vagas" | "pontos_por_questao" | "nota_minima" | "data_provavel" | "criado_em">;
      disciplina: Tab<{ concurso_slug: string; id: string; modulo: string | null; numero: number; titulo_literal: string; nome: string; questoes: number | null; peso: number | null; numeracao_itens: string | null; bibliografia_bruta: string | null }, "modulo" | "questoes" | "peso" | "numeracao_itens" | "bibliografia_bruta">;
      grupo_edital: Tab<{ concurso_slug: string; nome: string; questoes: number; disciplinas: string[] }>;
      item_edital: Tab<{ concurso_slug: string; id: string; disciplina_id: string; numero: string; texto: string; pai: string | null; pagina: number; ordem: number }, "pai">;
      prova: Tab<{ slug: string; concurso_slug: string; banca: string; ano: number; caderno: string | null; total_questoes: number; alternativas: number; gabarito_situacao: string; data_aplicacao: string | null; vigencia_suspeita: boolean; pdf_sha256: string | null }, "caderno" | "data_aplicacao" | "vigencia_suspeita" | "pdf_sha256">;
      questao: Tab<{
        id: string; schema_version: string; prova_slug: string | null; concurso_slug: string; numero_na_prova: number | null; tipo: string; enunciado: string; texto_apoio: string | null;
        alternativas: Json; anulada: boolean; peso: number; grupo_equivalencia: string | null; disciplina_ids: string[]; disciplina_nome: string; edital_item_id: string | null;
        edital_item_trilha: string[]; assunto: string | null; classificacao_status: string | null; classificacao_metodo: string | null; classificacao_score: number | null;
        origem_tipo: string; banca: string | null; ano: number | null; direitos_status: string; revisao_status: string; revisao_por: string | null; revisao_em: string | null;
        status: string; pendencias: string[]; gabarito_oficial: boolean; imagens: Json | null; atualizado_em: string;
      }, "prova_slug" | "numero_na_prova" | "texto_apoio" | "anulada" | "peso" | "grupo_equivalencia" | "edital_item_id" | "edital_item_trilha" | "assunto" | "classificacao_status" | "classificacao_metodo" | "classificacao_score" | "banca" | "ano" | "direitos_status" | "revisao_status" | "revisao_por" | "revisao_em" | "status" | "pendencias" | "gabarito_oficial" | "imagens" | "atualizado_em">;
      questao_gabarito: Tab<{ questao_id: string; correta: number | null; comentario: string | null; fundamentacao: Json | null }, "correta" | "comentario" | "fundamentacao">;
      registro_alteracao: Tab<{ id: number; criado_em: string; tipo: string; titulo: string; resumo: string | null; concurso_slug: string | null; questao_id: string | null; autor: string | null }, "id" | "criado_em" | "resumo" | "concurso_slug" | "questao_id" | "autor">;
      relatorio_simulado: Tab<{ simulado_id: string; gerado_em: string; conteudo: Json }, "gerado_em">;
      reporte_questao: Tab<{ id: number; usuario_id: string; questao_id: string; motivo: string; texto: string | null; criado_em: string; resolvido_em: string | null; resolucao: string | null; justificativa: string | null; resolvido_por: string | null }, "id" | "usuario_id" | "texto" | "criado_em" | "resolvido_em" | "resolucao" | "justificativa" | "resolvido_por">;
      resposta: Tab<{ simulado_id: string; posicao: number; letra: string | null; tempo_ms: number | null; chute: boolean; respondida_em: string; acertou: boolean | null; pontos: number | null }, "letra" | "tempo_ms" | "chute" | "respondida_em" | "acertou" | "pontos">;
      simulado: Tab<{ id: string; usuario_id: string; concurso_slug: string; seed: string; modo: string; status: string; config: Json; criado_em: string; finalizado_em: string | null }, "id" | "modo" | "status" | "config" | "criado_em" | "finalizado_em">;
      simulado_gabarito: Tab<{ simulado_id: string; posicao: number; letra_correta: string; snapshot: Json }>;
      simulado_item: Tab<{ simulado_id: string; posicao: number; questao_id: string; peso: number; ordem: number[]; payload: Json }, "peso">;
      usuario_concurso: Tab<{ usuario_id: string; concurso_slug: string; criado_em: string }, "usuario_id" | "criado_em">;
    };
    Views: { [k: string]: never };
    Functions: { apagar_dados_usuario: { Args: { p_usuario: string }; Returns: undefined }; resolver_reporte: { Args: { p_id: number; p_resolucao: string; p_justificativa: string; p_admin: string }; Returns: number }; usuario_atual: { Args: Record<string, never>; Returns: string } };
    Enums: { [k: string]: never };
    CompositeTypes: { [k: string]: never };
  };
}
