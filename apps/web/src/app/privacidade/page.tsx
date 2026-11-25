import { Pagina } from "@/components/Pagina";
import { Aviso } from "@/components/Aviso";

export const metadata = { title: "Política de privacidade" };

export default function Privacidade() {
  return (
    <Pagina estreita>
      <article className="pilha">
        <h1>Política de privacidade</h1>
        <Aviso aviso={{ nivel: "atencao", texto: "Documento em revisão. Os campos entre colchetes serão preenchidos antes do lançamento." }} />
        <h2>1. Quem é o controlador</h2>
        <p>[NOME DA EMPRESA], [CNPJ], [ENDEREÇO]. Encarregado de dados (LGPD): [NOME E E-MAIL].</p>
        <h2>2. Quais dados tratamos</h2>
        <ul>
          <li><strong>Conta:</strong> identificador da conta e os dados de login que você fornece ao provedor de autenticação (por exemplo, e-mail).</li>
          <li><strong>Uso do serviço:</strong> simulados criados, respostas, tempo por questão, marcações de chute e resultados.</li>
        </ul>
        <p>Não coletamos dados sensíveis, não usamos rastreadores de publicidade e não vendemos dados.</p>
        <h2>3. Para que usamos</h2>
        <p>Para operar os simulados, corrigir, gerar seus relatórios e manter a segurança do serviço. As estatísticas são mostradas a você sobre o seu próprio desempenho.</p>
        <h2>4. Base legal</h2>
        <p>Execução do contrato de uso da plataforma e cumprimento de obrigações legais. [REVISAR COM ADVOGADO: demais bases, se houver.]</p>
        <h2>5. Com quem compartilhamos</h2>
        <p>Usamos prestadores que tratam dados em nosso nome: autenticação ([PROVEDOR DE AUTENTICAÇÃO]), banco de dados e hospedagem ([PROVEDORES]). Alguns podem armazenar dados fora do Brasil. [DETALHAR TRANSFERÊNCIA INTERNACIONAL E GARANTIAS.]</p>
        <h2>6. Cookies</h2>
        <p>Usamos apenas cookies necessários para manter você logado e proteger a sessão.</p>
        <h2>7. Por quanto tempo guardamos</h2>
        <p>Enquanto a conta existir. Ao encerrar a conta, apagamos seus simulados, respostas e relatórios [PRAZO E EXCEÇÕES LEGAIS A DEFINIR].</p>
        <h2>8. Seus direitos</h2>
        <p>Você pode pedir confirmação do tratamento, acesso, correção, anonimização, portabilidade, eliminação e informações sobre compartilhamento, conforme o art. 18 da Lei 13.709/2018 (LGPD). Para exercer, escreva para [E-MAIL DO ENCARREGADO].</p>
        <h2>9. Segurança</h2>
        <p>Cada conta só acessa os próprios dados, a correção é feita no servidor e o gabarito não é enviado ao navegador antes de você finalizar o simulado.</p>
        <h2>10. Mudanças</h2>
        <p>Podemos atualizar esta política. Avisaremos na plataforma quando houver mudança relevante.</p>
      </article>
    </Pagina>
  );
}
