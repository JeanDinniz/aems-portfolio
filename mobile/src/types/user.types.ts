export type UserRole = 'owner' | 'user';

export interface User {
    id: number;
    full_name: string;
    email: string;
    role: UserRole;
    is_active: boolean;
    must_change_password: boolean;

    // Lojas
    store_id?: number | null;
    store_name?: string | null;
    supervised_store_ids?: number[];

    // Metadados
    created_at: string;
    updated_at: string;
    last_login?: string | null;
    phone?: string | null;
}

export interface CreateUserPayload {
    full_name: string;
    email: string;
    role: UserRole;
    password: string;
    store_id?: number;
    supervised_store_ids?: number[];
}

export interface UpdateUserPayload {
    full_name?: string;
    email?: string;
    role?: UserRole;
    store_id?: number | null;
    supervised_store_ids?: number[];
}

export interface UserFilters {
    role?: UserRole;
    is_active?: boolean;
    store_id?: number;
    search?: string;
}

export interface UsersListResponse {
    users: User[];
    total: number;
    page: number;
    pageSize: number;
}
