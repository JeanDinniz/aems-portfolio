import { useState, useEffect } from 'react';

/**
 * Observa a classe `dark` em <html> e retorna se o tema escuro está ativo.
 * Compartilhado entre os charts Recharts (que precisam recalcular cores de
 * grid/eixo/tooltip manualmente — Recharts não lê CSS variables).
 *
 * Padrão a ser adotado pelos gráficos — os charts do Dashboard (ex.:
 * RevenueTrendChart.tsx) ainda têm essa mesma lógica inline; não foram
 * migrados aqui para manter o escopo enxuto.
 */
export function useIsDark() {
  const [isDark, setIsDark] = useState(
    () => document.documentElement.classList.contains('dark')
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains('dark'))
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}
