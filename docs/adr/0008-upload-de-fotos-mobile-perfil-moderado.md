# 0008 — Upload de fotos no app: perfil "moderado" (paralelismo limitado, foto menor, timeout menor)

- **Status:** aceito
- **Data:** 2026-08-31
- **Tema:** mobile / redes instáveis / performance

## Contexto

No app, ao lançar uma O.S., o instalador anexa fotos que são **comprimidas e enviadas por uma fila
offline persistente** antes de a O.S. ser submetida — o envio da O.S. só libera quando todas as fotos têm
URL. Em lojas e no galpão a rede é instável, e o usuário relatou que **às vezes** o botão "Salvar e
Próxima" ficava travado em "Enviando fotos...".

O diagnóstico por leitura do código identificou três fatores somados:

1. Upload **serial** (uma foto por vez), somando latências quando há várias fotos.
2. Arquivos relativamente grandes (1600 px, JPEG 0,7).
3. Timeout de **120 s** por requisição: uma conexão morta "pendurava" até 2 minutos antes de cair no
   *backoff* / retry.

O cliente escolheu um nível **moderado** de ajuste e pediu que a decisão fosse **registrada e
reversível**.

## Decisão

Três ajustes de constante no pipeline de upload:

1. **Paralelismo limitado:** até **3 uploads simultâneos**. A **compressão continua serial** (mutex) — o
   pico de memória vem da manipulação nativa da imagem, não do POST; só arquivos já comprimidos sobem em
   paralelo.
2. **Foto menor:** 1280 px, JPEG 0,65.
3. **Timeout menor:** **60 s**, para uma conexão ruim cair no retry mais cedo.

**Reversão documentada** por constante (voltar a 1 upload simultâneo; 1600 px / 0,7; 120 s). Os testes
automatizados fixam esses valores, então qualquer mudança é intencional e visível.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Conservador** (só foto menor + timeout menor) | Menor risco de memória/banda | Ganho pequeno quando há muitas fotos. **Preterida.** |
| **Medir antes de otimizar** | Decisão baseada em métrica de campo | Adia o ganho; a causa já estava clara no código. **Preterida.** |
| **Rearquitetar** (upload nativo em background / chunked) | Robustez máxima | Custo alto para um problema intermitente. **Fora de escopo.** |
| **Moderado (escolhida)** | Ganho real com mudança mínima e reversível | Ver negativas. |

## Consequências

**Positivas**
- Com várias fotos, o envio total fica sensivelmente mais rápido (3 em voo).
- Arquivos menores sobem mais rápido e ocupam menos disco e banda no servidor.
- Falhas de rede são detectadas em cerca de 60 s, não 120 s.
- Mudança só no cliente: sem migration, sem impacto no backend.

**Negativas / riscos**
- Fotos um pouco menos detalhadas — avaliadas como suficientes para a conferência; reavaliar se algum caso
  exigir mais nitidez.
- Em rede muito ruim, 3 uploads competem pela banda; o *backoff* por item continua evitando loop.

## Como foi validado

- Testes unitários (Jest) do compressor, do upload e da fila, que fixam as novas constantes e o limite de
  concorrência.
- Suíte mobile completa verde (type-check, lint e Jest) antes do build.
