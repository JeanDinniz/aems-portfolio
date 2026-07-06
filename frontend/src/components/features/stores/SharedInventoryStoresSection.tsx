import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { storesService, type Store } from '@/services/api/stores.service'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'

const VISIBLE_ROWS = 5

interface Props {
    storeIds: number[]
    currentStoreId: number
    onChange: (ids: number[]) => void
}

export function SharedInventoryStoresSection({ storeIds, currentStoreId, onChange }: Props) {
    const [searchText, setSearchText] = useState('')
    const [selectedToAdd, setSelectedToAdd] = useState<Set<number>>(new Set())

    const { data: allStores = [], isLoading } = useQuery({
        queryKey: ['stores'],
        queryFn: () => storesService.list(),
        staleTime: 1000 * 60 * 5,
    })

    const linkedSet = useMemo(() => new Set(storeIds), [storeIds])

    const searchResults = useMemo(() => {
        if (!searchText.trim()) return []
        const q = searchText.toLowerCase()
        return allStores.filter(
            (s) =>
                s.id !== currentStoreId &&
                !linkedSet.has(s.id) &&
                (s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
        )
    }, [allStores, searchText, linkedSet, currentStoreId])

    const linkedStores = useMemo(() => {
        const map = new Map(allStores.map((s) => [s.id, s]))
        return storeIds.map((id) => map.get(id)).filter(Boolean) as Store[]
    }, [allStores, storeIds])

    const toggleToAdd = (id: number) => {
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
        onChange([...storeIds, ...toAdd])
        setSelectedToAdd(new Set())
        setSearchText('')
    }

    const handleRemove = (id: number) => {
        onChange(storeIds.filter((sid) => sid !== id))
    }

    const emptyRowCount = Math.max(0, VISIBLE_ROWS - linkedStores.length)

    return (
        <div className="space-y-4">
            <div>
                <label htmlFor="shared-store-search" className="text-sm font-medium mb-1.5 block">
                    Lojas parceiras
                </label>
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Input
                            id="shared-store-search"
                            value={searchText}
                            onChange={(e) => {
                                setSearchText(e.target.value)
                                setSelectedToAdd(new Set())
                            }}
                            placeholder="Nome ou código..."
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
                                        Nenhuma loja encontrada.
                                    </p>
                                ) : (
                                    <div className="py-1">
                                        {searchResults.map((store) => (
                                            <div
                                                key={store.id}
                                                className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50"
                                            >
                                                <Checkbox
                                                    checked={selectedToAdd.has(store.id)}
                                                    onCheckedChange={() => toggleToAdd(store.id)}
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium truncate">
                                                        {store.name}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground truncate">
                                                        {store.code}
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
                        Loja
                    </span>
                    <span className="w-24 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Código
                    </span>
                    <span className="w-20 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Remover
                    </span>
                </div>

                {isLoading ? (
                    <div className="p-2 space-y-1">
                        {[...Array(3)].map((_, i) => (
                            <Skeleton key={i} className="h-9 w-full" />
                        ))}
                    </div>
                ) : (
                    <div className="divide-y">
                        {linkedStores.map((store) => (
                            <div
                                key={store.id}
                                className="flex items-center px-4 py-2.5 hover:bg-muted/20"
                            >
                                <span className="flex-1 text-sm font-medium truncate pr-2">
                                    {store.name}
                                </span>
                                <span className="w-24 text-sm text-muted-foreground truncate pr-2 font-mono">
                                    {store.code}
                                </span>
                                <div className="w-20 flex justify-center">
                                    <Checkbox
                                        checked={false}
                                        onCheckedChange={() => handleRemove(store.id)}
                                        aria-label={`Remover ${store.name}`}
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
                                <span className="w-24" />
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
