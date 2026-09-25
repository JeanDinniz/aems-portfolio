import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usersService } from '@/services/api/users.service'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import type { User } from '@/types/user.types'

const VISIBLE_ROWS = 8

interface Props {
    userIds: string[]
    onChange: (ids: string[]) => void
}

export function ProfileUsersTab({ userIds, onChange }: Props) {
    const [searchText, setSearchText] = useState('')
    const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set())

    const { data, isLoading } = useQuery({
        queryKey: ['all-active-users', 'selectable'],
        queryFn: () => usersService.listSelectable({ is_active: true }, 1, 500),
        staleTime: 1000 * 60 * 5,
    })

    const allUsers = data?.users ?? []
    const linkedSet = useMemo(() => new Set(userIds), [userIds])

    const searchResults = useMemo(() => {
        if (!searchText.trim()) return []
        const q = searchText.toLowerCase()
        return allUsers.filter(
            (u) =>
                !linkedSet.has(u.id.toString()) &&
                (u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
        )
    }, [allUsers, searchText, linkedSet])

    const linkedUsers = useMemo(() => {
        const map = new Map(allUsers.map((u) => [u.id.toString(), u]))
        return userIds.map((id) => map.get(id)).filter(Boolean) as User[]
    }, [allUsers, userIds])

    const toggleToAdd = (id: string) => {
        setSelectedToAdd((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const handleVincular = () => {
        if (selectedToAdd.size === 0) return
        const toAdd = Array.from(selectedToAdd).filter((id) => !linkedSet.has(id))
        onChange([...userIds, ...toAdd])
        setSelectedToAdd(new Set())
        setSearchText('')
    }

    const handleRemove = (id: string) => {
        onChange(userIds.filter((uid) => uid !== id))
    }

    const emptyRowCount = Math.max(0, VISIBLE_ROWS - linkedUsers.length)

    return (
        <div className="space-y-4">
            <div>
                <label htmlFor="profile-user-search" className="text-sm font-medium mb-1.5 block">
                    Usuário <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Input
                            id="profile-user-search"
                            value={searchText}
                            onChange={(e) => {
                                setSearchText(e.target.value)
                                setSelectedToAdd(new Set())
                            }}
                            placeholder="Nome..."
                        />
                        {searchText.trim() && (
                            <div className="absolute z-50 top-full left-0 right-0 mt-1 border rounded-lg bg-popover shadow-lg max-h-52 overflow-y-auto">
                                {isLoading ? (
                                    <div className="p-2 space-y-1">
                                        <Skeleton className="h-8 w-full" />
                                        <Skeleton className="h-8 w-full" />
                                    </div>
                                ) : searchResults.length === 0 ? (
                                    <p className="text-sm text-muted-foreground p-3">
                                        Nenhum usuário encontrado.
                                    </p>
                                ) : (
                                    <div className="py-1">
                                        {searchResults.map((user) => (
                                            <div
                                                key={user.id}
                                                className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50"
                                            >
                                                <Checkbox
                                                    checked={selectedToAdd.has(user.id.toString())}
                                                    onCheckedChange={() =>
                                                        toggleToAdd(user.id.toString())
                                                    }
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium truncate">
                                                        {user.full_name}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground truncate">
                                                        {user.email}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <Button
                        type="button"
                        onClick={handleVincular}
                        disabled={selectedToAdd.size === 0}
                        className="shrink-0"
                    >
                        Vincular
                    </Button>
                </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
                <div className="flex items-center px-4 py-2 bg-muted/50 border-b">
                    <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Usuário
                    </span>
                    <span className="w-56 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        E-mail
                    </span>
                    <span className="w-20 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Remover
                    </span>
                </div>

                {isLoading ? (
                    <div className="p-2 space-y-1">
                        {[...Array(4)].map((_, i) => (
                            <Skeleton key={i} className="h-9 w-full" />
                        ))}
                    </div>
                ) : (
                    <div className="divide-y">
                        {linkedUsers.map((user) => (
                            <div
                                key={user.id}
                                className="flex items-center px-4 py-2.5 hover:bg-muted/20"
                            >
                                <span className="flex-1 text-sm font-medium truncate pr-2">
                                    {user.full_name}
                                </span>
                                <span className="w-56 text-sm text-muted-foreground truncate pr-2">
                                    {user.email}
                                </span>
                                <div className="w-20 flex justify-center">
                                    <Checkbox
                                        checked={false}
                                        onCheckedChange={() => handleRemove(user.id.toString())}
                                        aria-label={`Remover ${user.full_name}`}
                                    />
                                </div>
                            </div>
                        ))}
                        {[...Array(emptyRowCount)].map((_, i) => (
                            <div
                                key={`empty-${i}`}
                                className="flex items-center px-4 py-2.5 h-[42px]"
                            >
                                <span className="flex-1" />
                                <span className="w-56" />
                                <div className="w-20 flex justify-center">
                                    <Checkbox disabled className="opacity-30" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
