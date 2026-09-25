export type ServiceOrderStatus =
    | 'waiting'      // Aguardando
    | 'doing'        // Fazendo
    | 'ready'        // Pronto
    | 'cancelled'    // Cancelada
    | 'wrong'        // Lançado Errado
    | 'duplicate';   // Duplicado (nasce assim por duplicidade; resolve voltando p/ waiting)

export type Department = 'film' | 'security_film' | 'ppf' | 'vn' | 'vd' | 'vu' | 'bodywork' | 'workshop';

export interface ServiceOrder {
    id: number;
    order_number: string;
    external_os_number?: string | null;

    // Cliente e Veículo
    vehicle_brand?: string;
    vehicle_model?: string;
    vehicle_model_id?: number | null;
    vehicle_color?: string;
    vehicle_year?: number | null;
    plate: string;

    // Departamento e Serviço
    department: Department;
    service_type: string;        // Mantendo compatibilidade se necessário, ou usar service_description
    service_description?: string;  // Descrição livre do serviço (LEGACY - use items)
    items?: Array<{
        service_id: number;
        quantity: number;
        unit_price?: number;
        notes?: string;
        tonality?: string;
        roll_code?: string;
        service_name?: string | null;
        service_code?: string | null;
        service_department?: string | null;
        film_roll_id?: number | null;
        film_type_id?: number | null;
        /**
         * Retalho: o serviço foi feito com uma SOBRA de corte anterior, que já foi
         * debitada da bobina na época. Nesse caso o backend NÃO desconta metros de
         * nenhuma bobina e `film_roll_id` fica nulo.
         */
        used_scrap?: boolean;
        /**
         * Bobina de onde saiu o retalho — opcional e podendo estar `esgotada`
         * (o pedaço costuma vir de um rolo antigo). Só rastreabilidade; não debita.
         */
        scrap_source_roll_id?: number | null;
        /**
         * Tonalidades por região do carro (ex.: G20 nas portas, G05 no vidro traseiro).
         * `null`/ausente = item legado com tonalidade única. Quando presente, o consumo
         * de bobina no Finalizar é feito por tonalidade distinta (1 bobina por tonalidade).
         */
        film_applications?: Array<{
            tonality: string;
            region?: string | null;
            film_roll_id?: number | null;
            roll_code?: string | null;
            /** Retalho por tonalidade (mesma semântica do item). */
            used_scrap?: boolean;
            scrap_source_roll_id?: number | null;
        }> | null;
    }>;
    film_type?: string;          // Opcional agora, específico de film?

    // Workflow
    status: ServiceOrderStatus;
    entry_time: string;           // Hora de entrada (para semáforo)
    started_at: string | null;    // Quando começou (doing)
    completed_at: string | null;  // Quando finalizou

    // Equipe
    technician_id: number | null;
    technician_name: string | null;
    consultant_id: number | null;
    consultant_name: string | null;
    workers?: Array<{ id: number; employee_id: number; name: string; isPrimary: boolean }>;

    // Documentação
    photos: string[];              // URLs das fotos
    damage_photos: string[];        // URLs das fotos de avaria
    damage_map: string | null;     // Mapa de avarias
    invoice_number: string | null; // Número da NF

    // Localização
    location_id: number;
    location_name: string;
    dealership_id?: number;
    dealership_name?: string;
    is_galpon: boolean;
    is_return: boolean;
    is_courtesy: boolean;

    /** Briefing do consultor (preenchido no lançamento da O.S.). */
    notes: string | null;
    internal_notes?: string | null;
    /** Relato técnico do instalador (preenchido ao finalizar; máx. 2000). */
    execution_notes?: string | null;
    service_date: string | null;
    is_verified: boolean;
    verified_at: string | null;
    /** O.S. de origem quando esta O.S. é um Retorno (is_return). */
    original_service_order_id?: number | null;
    /** URL do vídeo opcional anexado à O.S. (1 por O.S., campo escalar). */
    video_url?: string | null;

    elapsed_minutes: number;

    // Timestamps
    created_at: string;
    updated_at: string;
    /** Nome do usuário que fez a última atualização (conferência/auditoria). */
    updated_by_name?: string | null;
}

/**
 * Payload de `POST /service-orders/{id}/finalize`.
 *
 * - `film_roll_assignments`: 1 atribuição por (service_id, tonalidade). `tonality`
 *   só para itens com tonalidades por região; itens legados vão sem `tonality`.
 *   Retalho (`used_scrap`): a bobina não é debitada; `film_roll_id` vai nulo/omitido
 *   e `scrap_source_roll_id` (opcional) só rastreia a origem.
 * - `employee_assignments`: instalador(es) por serviço (film/security_film/ppf) —
 *   obrigatório no backend para esses deptos (≥1). Nos demais, usar `employee_ids`.
 * - `execution_notes`: relato técnico do instalador (opcional, máx. 2000). Enviar
 *   trimado; vazio → omitir.
 */
export interface FinalizeServiceOrderPayload {
    completion_photos: string[];
    film_roll_assignments: {
        service_id: number;
        film_roll_id?: number | null;
        tonality?: string;
        used_scrap?: boolean;
        scrap_source_roll_id?: number | null;
    }[];
    employee_ids: number[];
    employee_assignments?: { service_id: number; employee_ids: number[] }[];
    execution_notes?: string | null;
}

/**
 * Prefill para "Gerar cópia da O.S." (Conferência → Criar O.S.).
 *
 * Objeto serializável (só primitivos/arrays) — trafega como param de navegação.
 * Copia tudo da O.S. original EXCETO departamento e serviços (o usuário escolhe
 * de novo). As fotos são URLs remotas já hospedadas no servidor (sem re-upload).
 */
export interface OSCopyPrefill {
    sourceOrderId: number;
    location_id?: number;
    is_galpon: boolean;
    is_return: boolean;
    is_courtesy: boolean;
    service_date?: string; // AAAA-MM-DD
    external_os_number?: string;
    plate: string;
    vehicle_model?: string;
    vehicle_model_id?: number;
    vehicle_color?: string;
    vehicle_year?: number;
    consultant_id?: number;
    notes?: string;
    photos: string[];
    damage_photos?: string[];
}

export interface CreateServiceOrderData {
    plate: string;
    vehicle_plate?: string;
    external_os_number?: string;
    vehicle_brand?: string;
    vehicle_model?: string;
    vehicle_model_id?: number;
    vehicle_color?: string;
    vehicle_year?: number;
    internal_notes?: string;
    department: Department;
    items: Array<{ service_id: number; quantity: number; notes?: string; tonality?: string; roll_code?: string; film_roll_id?: number | null; film_type_id?: number | null }>;
    location_id: number;
    /** O backend (ServiceOrderCreate) exige `store_id`; espelha `location_id`. */
    store_id?: number;
    dealership_id?: number;
    consultant_id?: number;
    workers?: Array<{ employee_id: number }>;
    notes?: string;
    photos?: string[];
    damage_map?: string;
    invoice_number?: string;
    is_galpon?: boolean;
    is_return?: boolean;
    is_courtesy?: boolean;
    service_date?: string;
    /**
     * O.S. de origem do Retorno. Quando `is_return` é falso, o backend zera o
     * vínculo; o front envia `null` nesse caso (espelha o web QuickCreateModal).
     */
    original_service_order_id?: number | null;
    /** URL do vídeo opcional (obtida via POST /upload/video). */
    video_url?: string | null;
}

export interface UpdateServiceOrderData {
    status?: ServiceOrderStatus;
    technician_id?: number;
    notes?: string;
    worker_ids?: number[];
    primary_worker_id?: number;
    invoice_number?: string;
    // Add other updateable fields as necessary
}

export interface ServiceOrderFilters {
    status?: string | string[];
    location_id?: number;
    start_date?: string;
    end_date?: string;
    search?: string;
    is_verified?: boolean;
    store_id?: number;
    date_from?: string;
    date_to?: string;
    department?: string;
    worker_id?: number;
    flag?: string[];
}
