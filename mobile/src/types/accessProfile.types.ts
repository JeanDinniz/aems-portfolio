export type ModuleGroup = 'ADM' | 'OPERACIONAL'

export type SubModule =
    | 'users'
    | 'stores'
    | 'consultants'
    | 'employees'
    | 'brands'
    | 'models'
    | 'services'
    | 'profiles'
    | 'service_orders'
    | 'conference'
    | 'fechamento'
    | 'scheduling'
    | 'scheduling_os'
    | 'inventory'

export interface ModulePermission {
    id: string
    profile_id: string
    module_group: ModuleGroup
    sub_module: SubModule
    can_view: boolean
    can_edit: boolean
    can_delete: boolean
}

export interface AccessProfile {
    id: string
    name: string
    description: string | null
    is_active: boolean
    is_galpon_profile: boolean
    hide_galpon_option: boolean
    permissions: ModulePermission[]
    store_ids: string[]
    stores: { id: number; name: string }[]
    user_ids: string[]
    created_at: string
    updated_at: string
}

export interface AccessProfileCreate {
    name: string
    description?: string
    is_active?: boolean
    is_galpon_profile?: boolean
    hide_galpon_option?: boolean
    permissions: Omit<ModulePermission, 'id' | 'profile_id'>[]
    store_ids?: string[]
    user_ids?: string[]
}

export type AccessProfileUpdate = Partial<AccessProfileCreate>

export interface AccessProfileListResponse {
    items: AccessProfile[]
    pagination: {
        page: number
        limit: number
        total: number
        total_pages: number
        has_next: boolean
        has_prev: boolean
    }
}

export interface EffectivePermissions {
    permissions: {
        sub_module: SubModule
        can_view: boolean
        can_edit: boolean
        can_delete: boolean
    }[]
    store_ids: string[]
    is_galpon_profile: boolean
    hide_galpon_option: boolean
}
