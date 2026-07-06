export type ServiceOrderStatus =
    | 'waiting'      // Aguardando
    | 'doing'        // Fazendo
    | 'ready'        // Pronto
    | 'cancelled'    // Cancelada
    | 'wrong'        // Lançado Errado
    | 'duplicate';   // Duplicado

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
    items?: Array<{ service_id: number; quantity: number; unit_price?: number; notes?: string; tonality?: string; roll_code?: string; service_name?: string | null; service_code?: string | null; film_roll_id?: number | null; film_type_id?: number | null }>;
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

    notes: string | null;
    internal_notes?: string | null;
    service_date: string | null;
    is_verified: boolean;
    verified_at: string | null;

    elapsed_minutes: number;

    // Timestamps
    created_at: string;
    updated_at: string;
    updated_by_name?: string | null;
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
    internal_notes?: string | null;
    department: Department;
    items: Array<{ service_id: number; quantity: number; notes?: string; tonality?: string; roll_code?: string; film_roll_id?: number | null; film_type_id?: number | null }>;
    location_id: number;
    dealership_id?: number;
    consultant_id?: number;
    workers?: Array<{ employee_id: number }>;
    notes?: string | null;
    photos?: string[];
    damage_map?: string;
    invoice_number?: string;
    is_galpon?: boolean;
    is_return?: boolean;
    is_courtesy?: boolean;
    service_date?: string;
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
