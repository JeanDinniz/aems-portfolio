export type UserRole = 'owner' | 'user';

export interface User {
    id: number;
    full_name: string;
    email: string;
    role: UserRole;
    is_active: boolean;
    must_change_password: boolean;
    store_id?: number | null;
    store_name?: string | null;
    supervised_store_ids?: number[];
    phone?: string | null;
    last_login?: string | null;
    created_at: string;
    updated_at?: string | null;
}

export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;          // segundos até expirar
}

export interface LoginCredentials {
    email: string;
    password: string;
}

export interface LoginResponse {
    user: User;
    tokens: AuthTokens;
    must_change_password?: boolean;
}

export interface AuthState {
    user: User | null;
    tokens: AuthTokens | null;
    isAuthenticated: boolean;
    isLoading: boolean;
}

