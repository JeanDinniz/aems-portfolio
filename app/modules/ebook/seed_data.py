"""
Conteúdo inicial do e-book (23 verbetes) — fonte única do seed.

Transcrito dos catálogos oficiais da AEMS (Estética, Película Térmica e
Película de Segurança). É consumido pela migration de seed
(20260715_100_ebook_seed) para popular a tabela ``ebook_items`` de forma
idempotente. Depois disso, o conteúdo é gerenciado pelo admin.

Cada item segue o shape de ``EbookItemCreate`` (sem os campos de mídia, que são
preenchidos depois pelo Owner). ``sales_faq`` é uma lista de
``{"question", "answer"}`` e ``technical_data`` de ``{"label", "value"}``.
"""

# fmt: off
EBOOK_SEED: list[dict] = [
    # ================= ESTÉTICA =================
    {
        "category": "estetica",
        "group": "lavagem",
        "slug": "lavagem-ecologica",
        "title": "Lavagem Ecológica",
        "display_order": 1,
        "description": (
            "A lavagem ecológica é uma solução moderna e sustentável que substitui a "
            "lavagem tradicional, utilizando produtos específicos que criam uma camada "
            "lubrificante sobre a pintura. Essa tecnologia amolece e encapsula a sujeira, "
            "permitindo sua remoção com segurança, sem danificar o veículo e sem "
            "desperdício de água."
        ),
        "procedure": [
            "Aplicação de produto lubrificante sobre a superfície",
            "Remoção da sujeira com pano de microfibra adequado",
            "Finalização com leve proteção impermeabilizante",
        ],
        "benefits": [
            "Economia de água",
            "Não agride a pintura quando feita corretamente",
            "Limpa e protege ao mesmo tempo",
            "Proteção contra raios UV, poluição e chuva ácida",
        ],
        "sales_approach": (
            "Você procura uma limpeza prática, segura e que já deixe o carro protegido "
            "no dia a dia?"
        ),
        "sales_faq": [
            {"question": "Arranha o carro?", "answer": "Não, utilizamos produtos com alta lubrificação que evitam atrito direto com a pintura."},
            {"question": "Serve para carro muito sujo?", "answer": "Para sujeira leve a moderada sim, em casos mais pesados indicamos outro método para preservar a pintura."},
            {"question": "Qual a vantagem?", "answer": "Além de limpar, já protege e mantém o carro bonito por mais tempo."},
        ],
        "sales_closing": "É o melhor custo-benefício para manter seu carro sempre limpo sem gastar muito.",
    },
    {
        "category": "estetica",
        "group": "lavagem",
        "slug": "lavagem-de-motor",
        "title": "Lavagem de Motor",
        "display_order": 2,
        "description": (
            "A lavagem de motor remove sujeira acumulada, óleo e resíduos, deixando o "
            "motor limpo e bem cuidado. É feita com segurança para não danificar "
            "componentes."
        ),
        "procedure": [
            "Proteção de partes sensíveis",
            "Limpeza técnica",
            "Secagem e acabamento",
        ],
        "benefits": [
            "Facilita manutenção",
            "Evita acúmulo de sujeira",
            "Melhora conservação",
            "Ajuda na identificação de vazamentos",
        ],
        "sales_approach": "Seu motor já foi limpo alguma vez?",
        "sales_faq": [
            {"question": "Não danifica?", "answer": "Não, é feito com proteção adequada."},
            {"question": "Vale a pena?", "answer": "Sim, ajuda na conservação."},
            {"question": "É só estética?", "answer": "Não, ajuda na manutenção."},
            {"question": "Com que frequência fazer?", "answer": "Depende do uso."},
        ],
        "sales_closing": "Motor limpo facilita tudo e valoriza o carro.",
    },
    {
        "category": "estetica",
        "group": "vidros",
        "slug": "remocao-de-chuva-acida",
        "title": "Remoção de Chuva Ácida",
        "display_order": 3,
        "description": (
            "Esse serviço remove manchas difíceis causadas por chuva ácida, poluição e "
            "resíduos que ficam impregnados no vidro. Devolve transparência e melhora a "
            "visibilidade."
        ),
        "procedure": [
            "Descontaminação dos vidros",
            "Polimento técnico",
            "Finalização",
        ],
        "benefits": [
            "Melhora visibilidade",
            "Remove manchas permanentes",
            "Recupera transparência",
            "Aumenta segurança",
        ],
        "sales_approach": "Seus vidros estão manchados ou opacos?",
        "sales_faq": [
            {"question": "Sai mesmo a mancha?", "answer": "Na maioria dos casos, sim."},
            {"question": "Melhora a visão?", "answer": "Muito."},
            {"question": "É só estética?", "answer": "Não, é segurança também."},
            {"question": "Vale a pena?", "answer": "Sim, principalmente para dirigir melhor."},
        ],
        "sales_closing": "Você volta a enxergar como vidro novo.",
    },
    {
        "category": "estetica",
        "group": "vidros",
        "slug": "cristalizacao-dos-vidros",
        "title": "Cristalização dos Vidros",
        "display_order": 4,
        "description": (
            "A cristalização cria uma camada protetora nos vidros que repele água, "
            "melhorando a visibilidade em dias de chuva. As gotas escorrem facilmente, "
            "aumentando a segurança ao dirigir."
        ),
        "procedure": [
            "Limpeza dos vidros",
            "Aplicação do produto",
            "Polimento e fixação",
        ],
        "benefits": [
            "Melhora visibilidade na chuva",
            "Aumenta segurança",
            "Repelência à água",
            "Facilita limpeza dos vidros",
        ],
        "sales_approach": "Você já teve dificuldade de enxergar na chuva?",
        "sales_faq": [
            {"question": "Funciona mesmo?", "answer": "Sim, a água escorre com facilidade."},
            {"question": "Ajuda à noite?", "answer": "Sim, melhora bastante a visibilidade."},
            {"question": "Dura quanto tempo?", "answer": "Depende do uso e limpeza."},
            {"question": "Vale a pena?", "answer": "Sim, principalmente por segurança."},
        ],
        "sales_closing": "É um serviço simples que aumenta muito sua segurança.",
    },
    {
        "category": "estetica",
        "group": "pintura",
        "slug": "enceramento",
        "title": "Enceramento",
        "display_order": 5,
        "description": (
            "O enceramento automotivo vai além da estética. Ele cria uma camada "
            "protetora sobre o verniz da pintura, protegendo contra ação do sol, "
            "sujeiras e agentes externos como fezes de aves e seiva de árvores."
        ),
        "procedure": [
            "Lavagem da carroceria",
            "Aplicação de cera automotiva premium",
            "Finalização com brilho e proteção",
        ],
        "benefits": [
            "Brilho intenso imediato",
            "Proteção contra raios solares",
            "Previne desgaste do verniz",
            "Facilita limpeza do veículo",
        ],
        "durability": "Até 3 meses",
        "sales_approach": "Quer dar um brilho rápido no carro e já proteger a pintura?",
        "sales_faq": [
            {"question": "Qual diferença para polimento?", "answer": "O enceramento protege e dá brilho, o polimento corrige riscos."},
            {"question": "Quanto dura?", "answer": "Em média até 3 meses."},
            {"question": "Vale a pena fazer sempre?", "answer": "Sim, ajuda a preservar o verniz e evita desgaste."},
        ],
        "sales_closing": "É a forma mais simples e econômica de manter o carro com aparência de novo.",
    },
    {
        "category": "estetica",
        "group": "pintura",
        "slug": "polimento",
        "title": "Polimento (Revitalização de Pintura)",
        "display_order": 6,
        "description": (
            "O polimento automotivo é um processo técnico que corrige imperfeições na "
            "pintura, como riscos superficiais, marcas e opacidade, devolvendo o brilho "
            "original e o aspecto de carro novo."
        ),
        "procedure": [
            "Correção de defeitos da pintura",
            "Etapas de corte, refino e lustro",
            "Possibilidade de lixamento técnico (quando necessário)",
            "Aplicação de proteção final",
        ],
        "benefits": [
            "Remove riscos superficiais",
            "Recupera o brilho da pintura",
            "Valoriza o veículo",
            "Aparência renovada",
        ],
        "care_notes": "Remove apenas riscos superficiais — riscos profundos que atingem o verniz por completo não são corrigidos.",
        "sales_approach": "Seu carro perdeu o brilho ou está com riscos?",
        "sales_faq": [
            {"question": "Remove todos os riscos?", "answer": "Remove riscos superficiais."},
            {"question": "Vale a pena?", "answer": "Sim, é o serviço que mais transforma a aparência."},
            {"question": "Danifica a pintura?", "answer": "Não, quando feito corretamente é seguro."},
        ],
        "sales_closing": "É o primeiro passo para deixar o carro com aparência de novo.",
    },
    {
        "category": "estetica",
        "group": "pintura",
        "slug": "vitrificacao-de-pintura",
        "title": "Vitrificação de Pintura",
        "display_order": 7,
        "description": (
            "A vitrificação é a mais avançada tecnologia em proteção automotiva. Forma "
            "uma camada cerâmica (9H) sobre a pintura, protegendo contra riscos, raios "
            "UV, chuva ácida e agentes externos, além de proporcionar brilho intenso e "
            "efeito hidrofóbico."
        ),
        "procedure": [
            "Polimento técnico completo",
            "Preparação da pintura",
            "Aplicação do coating cerâmico",
            "Cura e finalização",
        ],
        "benefits": [
            "Proteção de longa duração",
            "Resistência química e UV",
            "Redução de sujeira",
            "Brilho intenso e duradouro",
            "Facilidade de limpeza",
        ],
        "durability": "Até 3 anos (ou mais com manutenção)",
        "sales_approach": "Você quer só deixar bonito ou proteger seu carro por anos?",
        "sales_faq": [
            {"question": "Substitui lavagem?", "answer": "Não, mas facilita muito a limpeza."},
            {"question": "Vale o investimento?", "answer": "Sim, reduz manutenção e protege a pintura."},
            {"question": "Dura mesmo?", "answer": "Sim, com manutenção correta pode durar anos."},
        ],
        "sales_closing": "Se você quer manter seu carro sempre com aparência de novo e evitar desgaste, a vitrificação é o melhor investimento.",
    },
    {
        "category": "estetica",
        "group": "plastico",
        "slug": "vitrificacao-dos-plasticos",
        "title": "Vitrificação dos Plásticos",
        "display_order": 8,
        "description": (
            "A vitrificação de plásticos devolve a cor original e protege contra o "
            "desgaste causado pelo sol e tempo. Cria uma camada protetora que mantém o "
            "aspecto de novo."
        ),
        "procedure": [
            "Limpeza dos plásticos",
            "Aplicação do vitrificador",
            "Cura e acabamento",
        ],
        "benefits": [
            "Recupera cor original",
            "Protege contra sol",
            "Evita ressecamento",
            "Aumenta durabilidade",
        ],
        "sales_approach": "Seu plástico está desbotado?",
        "sales_faq": [
            {"question": "Volta ao original?", "answer": "Sim, melhora muito."},
            {"question": "Dura quanto tempo?", "answer": "Bem mais que produtos comuns."},
            {"question": "Protege mesmo?", "answer": "Sim, contra sol e desgaste."},
            {"question": "Vale a pena?", "answer": "Sim, valoriza o carro."},
        ],
        "sales_closing": "Deixa o carro com aparência muito mais nova.",
    },
    {
        "category": "estetica",
        "group": "interna",
        "slug": "higienizacao-interna",
        "title": "Higienização Interna",
        "display_order": 9,
        "description": (
            "A higienização interna é um processo detalhado que remove sujeiras "
            "profundas, manchas, odores e micro-organismos como fungos, ácaros e "
            "bactérias, proporcionando um ambiente mais saudável dentro do veículo."
        ),
        "procedure": [
            "Aspiração completa",
            "Limpeza de bancos, carpetes e teto",
            "Aplicação de produtos bactericidas",
            "Remoção de manchas e odores",
        ],
        "benefits": [
            "Elimina mau cheiro",
            "Remove bactérias e fungos",
            "Melhora a qualidade do ar",
            "Proporciona mais conforto e saúde",
        ],
        "sales_approach": "Seu carro está com cheiro ou manchas internas?",
        "sales_faq": [
            {"question": "Remove mesmo o cheiro?", "answer": "Sim, tratamos a causa e não só mascaramos."},
            {"question": "Sai qualquer mancha?", "answer": "A maioria sim, principalmente sujeiras do dia a dia."},
            {"question": "É só estética?", "answer": "Não, também é saúde."},
        ],
        "sales_closing": "Você passa muito tempo dentro do carro — vale a pena manter um ambiente limpo e seguro.",
    },
    {
        "category": "estetica",
        "group": "interna",
        "slug": "impermeabilizacao-de-tecido",
        "title": "Impermeabilização de Tecido",
        "display_order": 10,
        "description": (
            "A impermeabilização cria uma camada protetora nos tecidos, impedindo que "
            "líquidos e sujeiras sejam absorvidos. Isso facilita muito a limpeza e evita "
            "manchas permanentes."
        ),
        "procedure": [
            "Limpeza do tecido",
            "Aplicação do impermeabilizante",
            "Secagem e fixação",
        ],
        "benefits": [
            "Evita manchas",
            "Facilita limpeza",
            "Aumenta durabilidade do tecido",
            "Protege contra líquidos",
            "Mantém aparência limpa",
        ],
        "sales_approach": "Você já derramou algo no banco e manchou?",
        "sales_faq": [
            {"question": "Realmente não mancha?", "answer": "Evita a absorção, facilitando limpeza."},
            {"question": "Dura quanto tempo?", "answer": "Depende do uso, mas dura bastante."},
            {"question": "Funciona para qualquer tecido?", "answer": "Sim, com pequenas variações."},
            {"question": "Vale a pena?", "answer": "Sim, principalmente para quem usa muito o carro."},
        ],
        "sales_closing": "É proteção simples que evita dor de cabeça depois.",
    },
    {
        "category": "estetica",
        "group": "interna",
        "slug": "hidratacao-dos-bancos-de-couro",
        "title": "Hidratação dos Bancos de Couro",
        "display_order": 11,
        "description": (
            "A hidratação de couro é um serviço essencial para manter os bancos sempre "
            "bonitos, macios e bem conservados. Com o tempo, o couro vai ressecando por "
            "causa do sol, uso diário e variações de temperatura.\n\n"
            "Esse processo repõe a hidratação natural do material, devolvendo o brilho, "
            "a maciez e evitando rachaduras e desgaste precoce."
        ),
        "procedure": [
            "Limpeza completa do couro",
            "Neutralização do pH",
            "Aplicação de hidratante específico",
            "Finalização com proteção",
        ],
        "benefits": [
            "Evita rachaduras e ressecamento",
            "Aumenta a durabilidade do couro",
            "Mantém aparência de novo",
            "Mais conforto ao uso",
            "Protege contra desgaste diário",
        ],
        "sales_approach": "Seu banco já começou a ficar ressecado ou sem brilho?",
        "sales_faq": [
            {"question": "É só estética?", "answer": "Não, também evita rachaduras e desgaste."},
            {"question": "De quanto em quanto tempo fazer?", "answer": "O ideal é a cada 6 meses."},
            {"question": "Resolve couro ressecado?", "answer": "Sim, melhora bastante o aspecto e a maciez."},
            {"question": "Vale a pena?", "answer": "Sim, evita um gasto muito maior com troca do couro."},
        ],
        "sales_closing": "É um cuidado simples que prolonga muito a vida do seu banco.",
    },
    {
        "category": "estetica",
        "group": "interna",
        "slug": "vitrificacao-dos-bancos-de-couro",
        "title": "Vitrificação dos Bancos de Couro",
        "display_order": 12,
        "description": (
            "A vitrificação de couro é uma proteção avançada que cria uma camada "
            "invisível sobre o banco, protegendo contra sujeira, líquidos e desgaste. "
            "Ela mantém o couro com aparência original por muito mais tempo, facilitando "
            "a limpeza e evitando manchas."
        ),
        "procedure": [
            "Limpeza técnica do couro",
            "Preparação da superfície",
            "Aplicação do vitrificador",
            "Cura e finalização",
        ],
        "benefits": [
            "Proteção contra líquidos e sujeira",
            "Evita manchas",
            "Aumenta a durabilidade do couro",
            "Facilita limpeza",
            "Mantém aparência original",
        ],
        "sales_approach": "Você quer só limpar o couro ou proteger ele por muito mais tempo?",
        "sales_faq": [
            {"question": "Mancha menos?", "answer": "Sim, dificulta muito a absorção de líquidos."},
            {"question": "Muda o toque?", "answer": "Não, mantém natural."},
            {"question": "Vale o investimento?", "answer": "Sim, evita desgaste e sujeira acumulada."},
            {"question": "Dura quanto tempo?", "answer": "Com manutenção, dura bastante tempo."},
        ],
        "sales_closing": "É o melhor jeito de manter o couro sempre novo.",
    },
    {
        "category": "estetica",
        "group": "outros",
        "slug": "selante-para-pneus",
        "title": "Selante para Pneus",
        "display_order": 13,
        "description": (
            "O selante para pneus cria uma camada protetora que mantém o aspecto de "
            "novo, com brilho e proteção contra ressecamento."
        ),
        "procedure": [
            "Limpeza dos pneus",
            "Aplicação do selante",
            "Acabamento",
        ],
        "benefits": [
            "Evita ressecamento",
            "Mantém aparência nova",
            "Protege contra sol",
            "Melhora estética",
        ],
        "sales_approach": "Quer deixar o carro com acabamento de novo?",
        "sales_faq": [
            {"question": "Dura quanto tempo?", "answer": "Depende do uso."},
            {"question": "Protege mesmo?", "answer": "Sim, contra ressecamento."},
            {"question": "É só brilho?", "answer": "Não, também protege."},
            {"question": "Vale a pena?", "answer": "Sim, finaliza o visual do carro."},
        ],
        "sales_closing": "É o detalhe que faz toda diferença no resultado final.",
    },
    # ================= PELÍCULA TÉRMICA =================
    {
        "category": "pelicula_termica",
        "group": None,
        "slug": "pelicula-tintada",
        "title": "Película Tintada (Básica)",
        "display_order": 14,
        "description": (
            "A película tintada é a opção mais simples para quem deseja escurecer os "
            "vidros do carro e melhorar a estética de forma rápida e econômica.\n\n"
            "Ela ajuda a reduzir a claridade e aumentar um pouco a privacidade dentro do "
            "veículo. Porém, por ser uma tecnologia básica, não possui alta capacidade "
            "de bloqueio de calor.\n\n"
            "Com o tempo, pode desbotar, perder a cor e até comprometer a visibilidade, "
            "principalmente à noite ou em dias chuvosos. Por isso, é indicada para quem "
            "busca apenas um resultado visual com baixo investimento."
        ),
        "procedure": [
            "Limpeza completa dos vidros",
            "Aplicação da película com ajuste preciso",
            "Acabamento e fixação",
        ],
        "benefits": [
            "Leve aumento de privacidade",
            "Redução básica da incidência solar",
            "Ajuda mínima na preservação do interior",
            "Proteção limitada contra estilhaços",
        ],
        "sales_approach": "Você quer só melhorar o visual do carro ou também quer mais conforto e proteção?",
        "sales_faq": [
            {"question": "Ela segura o calor?", "answer": "Pouco, ela é mais voltada para estética."},
            {"question": "Dura quanto tempo?", "answer": "Pode perder a cor com o tempo."},
            {"question": "Prejudica a visão?", "answer": "Dependendo da qualidade, pode sim."},
            {"question": "Protege o interior do carro?", "answer": "De forma bem básica."},
        ],
        "sales_closing": "Ela resolve o visual, mas se você quiser conforto de verdade, vale a pena subir para uma térmica.",
    },
    {
        "category": "pelicula_termica",
        "group": None,
        "slug": "pelicula-poliester-comum",
        "title": "Película Poliéster Comum",
        "display_order": 15,
        "description": (
            "A película de poliéster comum é uma opção intermediária, indicada para quem "
            "quer melhorar o conforto visual e ter uma proteção básica contra o sol.\n\n"
            "Ela bloqueia os raios UV, ajudando a proteger a pele e também o interior do "
            "veículo, como painel e bancos, reduzindo o desgaste causado pelo sol.\n\n"
            "Apesar disso, sua capacidade de reduzir o calor ainda é limitada, então o "
            "carro pode continuar esquentando bastante em dias mais quentes.\n\n"
            "Com o tempo, pode sofrer alteração de cor, ficando com aspecto arroxeado."
        ),
        "procedure": [
            "Preparação e limpeza dos vidros",
            "Aplicação da película",
            "Acabamento técnico",
        ],
        "benefits": [
            "Proteção contra raios UV",
            "Redução de desgaste interno (painel e bancos)",
            "Melhora do conforto visual",
            "Proteção básica contra estilhaços",
            "Leve aumento de privacidade",
        ],
        "sales_approach": "Você quer só reduzir a claridade ou também quer diminuir o calor dentro do carro?",
        "sales_faq": [
            {"question": "Ela reduz o calor?", "answer": "Pouco, o foco maior é na proteção UV."},
            {"question": "Protege o interior?", "answer": "Sim, ajuda a evitar desgaste e desbotamento."},
            {"question": "Por que fica roxa?", "answer": "É normal nesse tipo de película com o tempo."},
            {"question": "Vale a pena?", "answer": "Para uso básico sim, mas não é a mais confortável."},
        ],
        "sales_closing": "Se você quer mais conforto térmico e proteção completa, a térmica já entrega bem mais resultado.",
    },
    {
        "category": "pelicula_termica",
        "group": None,
        "slug": "pelicula-termica-nano-ceramica",
        "title": "Película Térmica Pigmentada (Nano Cerâmica)",
        "display_order": 16,
        "description": (
            "A película térmica pigmentada é uma opção mais avançada, ideal para quem "
            "quer reduzir o calor dentro do carro e aumentar o conforto no dia a dia.\n\n"
            "Ela utiliza tecnologia que bloqueia grande parte do calor do sol, fazendo "
            "com que o interior do veículo fique muito mais agradável, principalmente em "
            "dias quentes.\n\n"
            "Também protege contra os raios UV, ajudando a preservar o interior do carro, "
            "evitando ressecamento, rachaduras e desbotamento de bancos, painel e "
            "acabamentos.\n\n"
            "Além disso, melhora a privacidade e mantém a cor por muito mais tempo sem "
            "desbotar."
        ),
        "procedure": [
            "Limpeza e preparação dos vidros",
            "Aplicação técnica da película",
            "Acabamento e cura",
        ],
        "benefits": [
            "Redução significativa do calor",
            "Proteção contra raios UV",
            "Conservação do interior do veículo",
            "Mais privacidade",
            "Proteção contra estilhaços",
            "Maior conforto ao dirigir",
        ],
        "sales_approach": "Seu carro esquenta muito quando fica no sol? Essa película resolve isso.",
        "sales_faq": [
            {"question": "Faz diferença no calor mesmo?", "answer": "Sim, você sente na hora."},
            {"question": "Protege o interior?", "answer": "Sim, evita desgaste e aumenta a durabilidade."},
            {"question": "Interfere no sinal?", "answer": "Não interfere."},
            {"question": "Vale o investimento?", "answer": "Sim, pelo conforto e proteção que entrega."},
        ],
        "sales_closing": "É o melhor custo-benefício entre conforto, proteção e durabilidade.",
    },
    {
        "category": "pelicula_termica",
        "group": None,
        "slug": "pelicula-termica-transparente",
        "title": "Película Térmica Transparente",
        "display_order": 17,
        "description": (
            "A película térmica transparente é perfeita para quem quer reduzir o calor e "
            "proteger o carro sem escurecer os vidros.\n\n"
            "Ela mantém a aparência original do veículo, mas oferece proteção contra o "
            "sol, reduzindo o calor interno e bloqueando os raios UV.\n\n"
            "É muito usada por quem não quer alterar o visual do carro ou precisa manter "
            "alta visibilidade, como no para-brisa."
        ),
        "procedure": [
            "Preparação dos vidros",
            "Aplicação da película",
            "Acabamento e cura",
        ],
        "benefits": [
            "Redução do calor sem escurecer",
            "Proteção contra raios UV",
            "Preservação do interior",
            "Não interfere em sinais eletrônicos",
            "Proteção contra estilhaços",
        ],
        "sales_approach": "Você quer conforto térmico sem mudar o visual do carro?",
        "sales_faq": [
            {"question": "Funciona mesmo sendo transparente?", "answer": "Sim, a tecnologia está na proteção térmica."},
            {"question": "Protege o interior?", "answer": "Sim, igual às outras térmicas."},
            {"question": "Interfere no GPS ou TAG?", "answer": "Não interfere."},
            {"question": "Vale a pena?", "answer": "Principalmente para quem quer discrição."},
        ],
        "sales_closing": "Você mantém o visual original e ganha conforto — é o melhor dos dois mundos.",
    },
    {
        "category": "pelicula_termica",
        "group": None,
        "slug": "pelicula-premium",
        "title": "Película Premium (Alta Performance)",
        "display_order": 18,
        "description": (
            "As películas premium são a melhor opção para quem busca o máximo em "
            "conforto, proteção e tecnologia.\n\n"
            "Elas reduzem drasticamente o calor dentro do carro, bloqueiam praticamente "
            "todos os raios UV e ajudam a manter o interior sempre conservado.\n\n"
            "Além disso, têm alta durabilidade, não interferem em sinais eletrônicos e "
            "oferecem excelente visibilidade."
        ),
        "procedure": [
            "Preparação completa dos vidros",
            "Aplicação profissional",
            "Acabamento premium",
        ],
        "benefits": [
            "Máxima redução de calor",
            "Proteção total contra raios UV",
            "Preservação completa do interior",
            "Alta durabilidade",
            "Proteção contra estilhaços",
            "Maior conforto e valorização do veículo",
        ],
        "sales_approach": "Você quer só uma película ou quer o melhor que existe hoje?",
        "sales_faq": [
            {"question": "Por que é mais cara?", "answer": "Porque entrega muito mais tecnologia e durabilidade."},
            {"question": "Vale o investimento?", "answer": "Sim, principalmente a longo prazo."},
            {"question": "Protege o interior?", "answer": "Sim, é a melhor proteção possível."},
            {"question": "Qual a diferença real?", "answer": "Mais conforto, mais proteção e mais durabilidade."},
        ],
        "sales_closing": "Se você quer o máximo em conforto, proteção e valorização do seu carro, essa é a melhor escolha.",
    },
    # ================= PELÍCULA DE SEGURANÇA =================
    {
        "category": "pelicula_seguranca",
        "group": None,
        "slug": "ps4",
        "title": "PS4 (Comum)",
        "display_order": 19,
        "description": (
            "A película PS4 é a opção de entrada para quem busca mais segurança no "
            "veículo. Ela cria uma camada protetora sobre o vidro, aumentando sua "
            "resistência e evitando que ele se estilhace facilmente em caso de "
            "impacto.\n\n"
            "É ideal para uso urbano, trazendo mais tranquilidade no dia a dia sem "
            "exigir um alto investimento."
        ),
        "procedure": [
            "Limpeza técnica dos vidros",
            "Aplicação da película com ajuste preciso",
            "Remoção de bolhas e acabamento",
            "Cura parcial em até 7 dias e total em até 30 dias",
        ],
        "benefits": [
            "Dificulta a quebra imediata do vidro",
            "Reduz risco de ferimentos com estilhaços",
            "Proteção UV 99%",
            "Melhora conforto térmico leve",
            "Preserva painel e estofados contra desgaste solar",
        ],
        "technical_data": [
            {"label": "Espessura", "value": "0,1 mm (100 microns)"},
            {"label": "Resistência à ruptura", "value": "~80 kg"},
            {"label": "Rejeição IR (calor)", "value": "~10%"},
            {"label": "Proteção UV", "value": "99%"},
            {"label": "Nível de proteção", "value": "Básico (antivandalismo leve)"},
        ],
        "security_scenarios": [
            "Tentativas rápidas de furto no trânsito",
            "Quebra de vidro em semáforos",
            "Pequenos impactos ou acidentes",
            "Evita que estilhaços se espalhem dentro do carro",
        ],
        "sales_approach": "Você quer aumentar a segurança do seu carro sem investir muito?",
        "sales_faq": [
            {"question": "Isso realmente protege?", "answer": "Sim, dificulta bastante a quebra rápida do vidro."},
            {"question": "É igual blindagem?", "answer": "Não, mas já aumenta muito a segurança."},
            {"question": "Vale a pena?", "answer": "Sim, é o melhor custo-benefício."},
            {"question": "Dá diferença no dia a dia?", "answer": "Sim, principalmente em trânsito e estacionamento."},
        ],
        "sales_closing": "É uma proteção simples, acessível e que já evita muitos problemas.",
    },
    {
        "category": "pelicula_seguranca",
        "group": None,
        "slug": "ps4-termica",
        "title": "PS4 Térmica",
        "display_order": 20,
        "description": (
            "A PS4 térmica combina proteção antivandalismo com tecnologia nano cerâmica "
            "para controle de calor. Além da segurança, ela melhora significativamente o "
            "conforto interno do veículo.\n\n"
            "Ideal para quem quer segurança com mais conforto térmico."
        ),
        "procedure": [
            "Preparação dos vidros",
            "Aplicação da película nano cerâmica",
            "Acabamento técnico",
            "Cura completa",
        ],
        "benefits": [
            "Proteção contra impacto e estilhaços",
            "Redução de até 90% do calor",
            "Proteção UV 99%",
            "Maior conforto ao dirigir",
            "Evita desbotamento de interior",
        ],
        "technical_data": [
            {"label": "Espessura", "value": "0,1 mm"},
            {"label": "Resistência", "value": "~80 kg"},
            {"label": "Rejeição IR", "value": "até 90%"},
            {"label": "Energia solar rejeitada", "value": "~55%"},
            {"label": "Tecnologia", "value": "Nano cerâmica"},
            {"label": "Nível de proteção", "value": "Básico + conforto térmico"},
        ],
        "security_scenarios": [
            "Mesmos cenários da PS4",
            "Redução de fadiga ao dirigir",
            "Menor exposição ao calor extremo",
            "Proteção da pele e visão",
        ],
        "sales_approach": "Você quer segurança e ainda reduzir o calor dentro do carro?",
        "sales_faq": [
            {"question": "Esquenta menos mesmo?", "answer": "Sim, a diferença é muito perceptível."},
            {"question": "Vale mais que a comum?", "answer": "Sim, você ganha conforto junto."},
            {"question": "Interfere em sinal?", "answer": "Não, tecnologia sem metal."},
            {"question": "Compensa o valor?", "answer": "Sim, principalmente no uso diário."},
        ],
        "sales_closing": "Você resolve segurança e conforto em um único serviço.",
    },
    {
        "category": "pelicula_seguranca",
        "group": None,
        "slug": "ps8",
        "title": "PS8",
        "display_order": 21,
        "description": (
            "A PS8 oferece um nível intermediário de proteção, com maior espessura e "
            "resistência que a PS4. Ela exige mais força e tempo para quebra, aumentando "
            "significativamente a segurança."
        ),
        "procedure": [
            "Limpeza e preparação",
            "Aplicação da película",
            "Finalização técnica",
            "Cura completa",
        ],
        "benefits": [
            "Maior resistência contra impactos",
            "Dificulta invasões",
            "Retém estilhaços",
            "Proteção UV 99%",
            "Preserva interior",
        ],
        "technical_data": [
            {"label": "Espessura", "value": "0,2 mm (200 microns)"},
            {"label": "Resistência", "value": "~101 kg"},
            {"label": "Rejeição IR", "value": "~10%"},
            {"label": "Proteção UV", "value": "99%"},
            {"label": "Nível", "value": "Intermediário"},
        ],
        "security_scenarios": [
            "Tentativas de arrombamento mais agressivas",
            "Quebra de vidro com objetos",
            "Aumenta tempo de reação contra invasão",
        ],
        "sales_approach": "Você quer uma proteção mais forte que o básico?",
        "sales_faq": [
            {"question": "Qual a diferença da PS4?", "answer": "Mais espessa e mais resistente."},
            {"question": "Segura tentativa de roubo?", "answer": "Dificulta bastante."},
            {"question": "Vale a pena?", "answer": "Sim, é um ótimo meio termo."},
            {"question": "Fica muito escura?", "answer": "Tem opções."},
        ],
        "sales_closing": "É o equilíbrio ideal entre custo e segurança.",
    },
    {
        "category": "pelicula_seguranca",
        "group": None,
        "slug": "ps12",
        "title": "PS12",
        "display_order": 22,
        "description": (
            "A PS12 já é considerada uma película de alta proteção, oferecendo grande "
            "resistência contra impactos e dificultando muito a quebra do vidro."
        ),
        "procedure": [
            "Aplicação técnica avançada",
            "Ajustes e acabamento",
            "Cura controlada",
        ],
        "benefits": [
            "Alta resistência contra impacto",
            "Grande retenção de estilhaços",
            "Proteção UV 99%",
            "Mais segurança contra invasões",
            "Protege interior do veículo",
        ],
        "technical_data": [
            {"label": "Espessura", "value": "~0,3 mm"},
            {"label": "Resistência", "value": "~189 kg"},
            {"label": "Rejeição IR", "value": "~10%"},
            {"label": "Proteção UV", "value": "99%"},
            {"label": "Nível", "value": "Alto"},
        ],
        "security_scenarios": [
            "Tentativas fortes de arrombamento",
            "Ataques com ferramentas",
            "Acidentes com alto impacto",
            "Alta proteção urbana",
        ],
        "sales_approach": "Você quer um nível de segurança realmente alto?",
        "sales_faq": [
            {"question": "É muito resistente?", "answer": "Sim, é um nível bem alto."},
            {"question": "Vale o investimento?", "answer": "Sim, para segurança real."},
            {"question": "Substitui blindagem?", "answer": "Não, mas ajuda muito."},
            {"question": "Quem usa?", "answer": "Quem prioriza segurança."},
        ],
        "sales_closing": "É proteção de verdade no dia a dia.",
    },
    {
        "category": "pelicula_seguranca",
        "group": None,
        "slug": "ps16",
        "title": "PS16 (Top)",
        "display_order": 23,
        "description": (
            "A PS16 é o nível máximo de proteção entre as películas antivandalismo. Com "
            "maior espessura e resistência, oferece o melhor desempenho contra impactos "
            "e invasões."
        ),
        "procedure": [
            "Aplicação especializada",
            "Ajuste técnico",
            "Cura completa",
        ],
        "benefits": [
            "Máxima resistência",
            "Alta retenção de estilhaços",
            "Grande dificuldade de invasão",
            "Proteção UV 99%",
            "Preserva interior",
        ],
        "technical_data": [
            {"label": "Espessura", "value": "0,345 mm"},
            {"label": "Resistência", "value": "~220 kg"},
            {"label": "Rejeição IR", "value": "~10%"},
            {"label": "Proteção UV", "value": "99%"},
            {"label": "Nível", "value": "Máximo"},
        ],
        "security_scenarios": [
            "Tentativas severas de invasão",
            "Situações de risco elevado",
            "Proteção reforçada no trânsito e estacionamentos",
        ],
        "sales_approach": "Você quer o máximo de segurança possível sem blindar?",
        "sales_faq": [
            {"question": "É a mais forte?", "answer": "Sim, topo da categoria."},
            {"question": "Vale o valor?", "answer": "Para segurança máxima, sim."},
            {"question": "Diferença é grande?", "answer": "Sim, principalmente na resistência."},
            {"question": "Indicado pra quem?", "answer": "Quem não quer correr risco."},
        ],
        "sales_closing": "Se segurança é prioridade, essa é a melhor escolha.",
    },
]
# fmt: on
