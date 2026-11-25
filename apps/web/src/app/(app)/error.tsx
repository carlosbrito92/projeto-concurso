"use client";

export default function Erro({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="painel pilha-p" role="alert">
      <h1>Algo falhou ao carregar esta página</h1>
      <p>Pode ser uma instabilidade passageira na conexão ou no servidor. Suas respostas já enviadas continuam salvas.</p>
      <button type="button" className="btn btn-primario" onClick={reset}>Tentar de novo</button>
    </div>
  );
}
