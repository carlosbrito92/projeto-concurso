import { Pagina } from "@/components/Pagina";
import { Aviso } from "@/components/Aviso";

export const metadata = { title: "Termos de uso" };

export default function Termos() {
  return (
    <Pagina estreita>
      <article className="pilha">
        <h1>Termos de uso</h1>
        <Aviso aviso={{ nivel: "atencao", texto: "Documento em revisão. Os campos entre colchetes serão preenchidos antes do lançamento." }} />
        <h2>1. O serviço</h2>
        <p>A plataforma oferece simulados baseados em editais de concursos públicos, com correção automática e relatório de desempenho por disciplina e por assunto do edital. O serviço é de apoio ao estudo e não substitui o edital oficial nem o material indicado pela banca.</p>
        <h2>2. Conta</h2>
        <p>O acesso exige conta. Você é responsável por manter seus dados de acesso em sigilo e pelas atividades feitas na sua conta. Os dados de login são tratados pelo provedor de autenticação descrito na Política de Privacidade.</p>
        <h2>3. Uso permitido</h2>
        <p>É proibido copiar o banco de questões de forma automatizada, redistribuir o conteúdo, tentar acessar dados de outras contas ou contornar limites técnicos do serviço.</p>
        <h2>4. Conteúdo</h2>
        <p>Questões de provas anteriores pertencem aos seus titulares e são exibidas conforme as autorizações obtidas [REVISAR COM ADVOGADO ANTES DO LANÇAMENTO]. A organização do conteúdo, os relatórios e o software da plataforma pertencem a [NOME DA EMPRESA].</p>
        <h2>5. Legislação e gabaritos</h2>
        <p>Questões de provas antigas podem se basear em lei que foi alterada ou revogada. A plataforma sinaliza esses casos, mas não garante que o texto da questão reflita a legislação vigente. Gabaritos não confirmados como definitivos são identificados como tal. Confira sempre a fonte oficial atual.</p>
        <h2>6. Resultados</h2>
        <p>Os relatórios são estatísticas do seu próprio desempenho nos simulados feitos na plataforma. Não representam previsão nem garantia de aprovação.</p>
        <h2>7. Pagamentos</h2>
        <p>[A DEFINIR: planos, valores, cobrança, cancelamento e reembolso.]</p>
        <h2>8. Encerramento</h2>
        <p>Você pode encerrar a conta quando quiser, solicitando pelo canal de contato. Podemos suspender contas que violem estes termos.</p>
        <h2>9. Alterações</h2>
        <p>Estes termos podem mudar. Mudanças relevantes serão comunicadas na plataforma antes de valerem.</p>
        <h2>10. Contato e foro</h2>
        <p>[E-MAIL DE CONTATO]. Foro: [COMARCA], salvo disposição legal em contrário.</p>
      </article>
    </Pagina>
  );
}
