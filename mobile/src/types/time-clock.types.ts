/**
 * Ponto Eletrônico — tipos fiéis aos contratos do backend (`/time-clock`).
 *
 * O horário é do servidor: o app NUNCA envia data/hora; apenas `type`,
 * `photo_url` e a geolocalização. As respostas trazem `recorded_at` já validado
 * pelo servidor e o distanciamento do raio da loja.
 */

/** Tipo da batida: entrada ou saída. */
export type PunchType = 'in' | 'out';

/**
 * Origem do registro de ponto (Portaria MTP 671/2021 — trilha de auditoria).
 * `employee` = batida do próprio funcionário; `admin_adjustment` = ajuste
 * administrativo lançado no espelho (pode não ter foto/GPS).
 */
export type TimeClockSource = 'employee' | 'admin_adjustment';

/** Corpo do `POST /time-clock/punch`. */
export interface PunchPayload {
    type: PunchType;
    photo_url: string;
    latitude: number;
    longitude: number;
    /** Precisão horizontal estimada (metros), quando o aparelho reporta. */
    accuracy_m?: number;
    /**
     * Embedding do rosto da batida (Fase 2 — reconhecimento facial), gerado no
     * aparelho. Opcional; só enviado quando o funcionário tem rosto cadastrado.
     */
    face_embedding?: number[];
    /**
     * Horário do relógio DO APARELHO no momento da batida (ISO 8601 com fuso,
     * ex.: "2026-08-05T08:00:00-03:00). METADADO — o horário OFICIAL continua
     * sendo o do servidor. Preservado nas batidas offline para registrar o
     * instante real da marcação, mesmo que o envio ocorra depois (no sync).
     */
    client_reported_at?: string;
    /**
     * `true` quando a batida foi coletada OFFLINE e sincronizada depois. Nessa
     * situação o horário oficial passa a ser o `client_reported_at` (REP-A).
     * A batida ONLINE envia `false`.
     */
    is_offline?: boolean;
}

/**
 * Comprovante de registro de ponto (REP-A) gerado pelo SERVIDOR, com o NSR real
 * atribuído no INSERT. Acompanha a resposta da batida (`TimeClockRecord.receipt`)
 * quando há NSR; o PDF sai por `GET /time-clock/records/{id}/receipt?format=pdf`.
 */
export interface TimeClockReceipt {
    /** Número Sequencial de Registro (contador global do empregador). */
    nsr: number;
    employer_name: string;
    employer_cnpj: string;
    employee_name: string;
    employee_cpf: string | null;
    type: PunchType;
    /** ISO datetime do horário OFICIAL do registro. */
    recorded_at: string;
    is_offline_record: boolean;
    /** Identificador interno do sistema (ex.: "AEMS-REP-A"). */
    system_id: string;
    /** Últimos dígitos do hash de integridade (conferência). */
    hash_short: string;
}

/** Registro de batida (item de `today`/`recent`). */
export interface TimeClockRecord {
    id: number;
    type: PunchType;
    /** ISO datetime do servidor (horário OFICIAL). */
    recorded_at: string;
    /** Pode vir null em ajustes administrativos (sem selfie). */
    photo_url: string | null;
    /** Distância (m) até a loja no momento da batida. */
    distance_m: number | null;
    /** `false` = batida fora do raio configurado da loja. */
    is_within_radius: boolean;
    /** Similaridade [0..1] com o rosto cadastrado (Fase 2); null se não conferido. */
    face_match_score?: number | null;
    /** Resultado advisory do reconhecimento (Fase 2a não bloqueia); null se não conferido. */
    face_verified?: boolean | null;
    /**
     * Horário do relógio do aparelho no momento da batida (ISO com fuso).
     * METADADO enviado pelo app; `null` em batidas antigas/ajustes.
     */
    client_reported_at?: string | null;
    /** Origem do registro: batida do funcionário ou ajuste administrativo. */
    source?: TimeClockSource;
    /** Motivo do ajuste administrativo (quando `source === 'admin_adjustment'`). */
    adjustment_reason?: string | null;
    /** Id do registro anulado por este ajuste (quando aplicável). */
    annuls_record_id?: number | null;
    /**
     * Número Sequencial de Registro atribuído no INSERT (REP-A). `null` em
     * registros antigos anteriores à corrente de integridade.
     */
    nsr?: number | null;
    /** `true` quando a batida foi coletada offline (horário = client_reported_at). */
    is_offline_record?: boolean;
    /**
     * `true` quando uma batida offline foi sincronizada MUITO depois da marcação
     * (> 24h) — sinal de conferência do RH contra backdating.
     */
    offline_sync_late?: boolean;
    /** Instante em que a batida offline foi recebida/sincronizada pelo servidor. */
    synced_at?: string | null;
    /** Comprovante do registro (presente quando há `nsr`). */
    receipt?: TimeClockReceipt | null;
}

/**
 * Registro do Espelho de Ponto (`GET /time-clock`), mais rico que o item de
 * `me`: carrega funcionário/loja, data e a geolocalização completa. Usado só na
 * tela administrativa (Espelho de Ponto).
 */
export interface TimeClockMirrorRecord {
    id: number;
    employee_id: number;
    employee_name: string;
    store_id: number;
    store_name: string;
    type: PunchType;
    /** ISO datetime do servidor. */
    recorded_at: string;
    /** Data (YYYY-MM-DD) da batida. */
    recorded_date: string;
    latitude: number;
    longitude: number;
    /** Precisão horizontal (m) reportada pelo aparelho — pode ser nula. */
    accuracy_m: number | null;
    /** Distância (m) até a loja no momento da batida — pode ser nula. */
    distance_m: number | null;
    /** `null` quando a loja não tem geofence configurado. */
    is_within_radius: boolean | null;
    photo_url: string;
    /** `true` quando a batida foi coletada offline (horário = do aparelho). */
    is_offline_record?: boolean;
    /**
     * `true` quando a batida offline foi sincronizada MUITO depois da marcação
     * (> 24h) — sinal de conferência do RH contra backdating.
     */
    offline_sync_late?: boolean;
}

/** Resposta paginada do `GET /time-clock` (espelho). */
export interface TimeClockMirrorResponse {
    items: TimeClockMirrorRecord[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        total_pages: number;
        has_next: boolean;
        has_prev: boolean;
    };
}

/** Filtros do `GET /time-clock` (espelho). */
export interface TimeClockMirrorFilters {
    store_id?: number;
    date?: string;
    employee_id?: number;
    page?: number;
    limit?: number;
}

/** Corpo do `POST /time-clock/enroll-face`. */
export interface EnrollFacePayload {
    /** Embedding facial gerado NO APARELHO (32–2048 números finitos). */
    embedding: number[];
    /** Consentimento LGPD (obrigatório; 422 sem ele). */
    consent: boolean;
}

/** Resposta do `POST /time-clock/enroll-face` (201). */
export interface EnrollFaceResponse {
    enrolled: boolean;
    /** ISO datetime do cadastro. */
    enrolled_at: string;
    /** Dimensão do embedding aceito pelo servidor. */
    dimension: number;
}

/** Resposta do `GET /time-clock/me`. */
export interface TimeClockMe {
    /** `null` quando o usuário logado não tem vínculo com um funcionário. */
    employee_id: number | null;
    employee_name: string | null;
    store_name: string | null;
    /** `true` quando o funcionário já cadastrou o rosto de referência. */
    face_enrolled: boolean;
    /** Horário de trabalho `HH:MM(:SS)` — pode vir nulo. */
    work_start_time: string | null;
    work_end_time: string | null;
    /** Última batida do dia (define se o próximo botão é Entrada/Saída). */
    last_type: PunchType | null;
    /** Batidas de hoje (ordem do servidor). */
    today: TimeClockRecord[];
    /** Batidas recentes (últimos dias). */
    recent: TimeClockRecord[];
}

/** Período do autoatendimento "Meu Espelho" (`GET /time-clock/me/mirror`). */
export type MyMirrorPeriod = '24h' | 'month';

/**
 * Resposta do `GET /time-clock/me/mirror?period=24h|month` — autoatendimento do
 * funcionário (Portaria MTP 671/2021: acesso do próprio trabalhador ao espelho).
 * O `GET /time-clock/me/export/pdf?period=` gera o mesmo recorte em PDF.
 */
export interface TimeClockMyMirrorResponse {
    period: MyMirrorPeriod;
    employee_id: number;
    employee_name: string;
    store_name: string | null;
    /** ISO datetime — início da janela consultada. */
    start: string;
    /** ISO datetime — fim da janela consultada. */
    end: string;
    items: TimeClockRecord[];
}
