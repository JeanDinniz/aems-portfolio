import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { accessProfilesService } from '@/services/api/access-profiles.service';
import { useProfileUsers } from '@/hooks/useAccessProfiles';

const MIN_ROWS = 4;

interface UserProfilesSectionProps {
    userId: string;
}

export function UserProfilesSection({ userId }: UserProfilesSectionProps) {
    const { data, isLoading } = useQuery({
        queryKey: ['access-profiles', { is_active: true, limit: 500 }],
        queryFn: () => accessProfilesService.list({ is_active: true, limit: 500 }),
        staleTime: 1000 * 60 * 5,
    });

    const profiles = data?.items ?? [];

    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [searchText, setSearchText] = useState('');
    const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (profiles.length > 0) {
            const linkedIds = new Set(
                profiles
                    .filter((p) => p.user_ids.some((id) => String(id) === userId))
                    .map((p) => String(p.id))
            );
            setSelected(linkedIds);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [profiles.length, userId]);

    const { addUsers, removeUsers } = useProfileUsers();

    const linkedProfiles = useMemo(
        () => profiles.filter((p) => selected.has(String(p.id))),
        [profiles, selected]
    );

    const searchResults = useMemo(() => {
        if (!searchText.trim()) return [];
        const q = searchText.toLowerCase();
        return profiles.filter(
            (p) => !selected.has(String(p.id)) && p.name.toLowerCase().includes(q)
        );
    }, [profiles, searchText, selected]);

    const toggleToAdd = (profileId: string) => {
        setSelectedToAdd((prev) => {
            const next = new Set(prev);
            if (next.has(profileId)) next.delete(profileId);
            else next.add(profileId);
            return next;
        });
    };

    const handleVincular = () => {
        if (selectedToAdd.size === 0) return;
        const toAdd = Array.from(selectedToAdd);
        setSelected((prev) => {
            const next = new Set(prev);
            toAdd.forEach((id) => next.add(id));
            return next;
        });
        toAdd.forEach((profileId) => {
            addUsers.mutate({ id: profileId, user_ids: [userId] });
        });
        setSelectedToAdd(new Set());
        setSearchText('');
    };

    const handleRemove = (profileId: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            next.delete(profileId);
            return next;
        });
        removeUsers.mutate({ id: profileId, user_ids: [userId] });
    };

    const emptyRowCount = Math.max(0, MIN_ROWS - linkedProfiles.length);

    if (isLoading) {
        return (
            <div className="space-y-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-3/4" />
            </div>
        );
    }

    if (profiles.length === 0) {
        return (
            <p className="text-sm text-muted-foreground">
                Nenhum perfil de acesso ativo cadastrado.
            </p>
        );
    }

    return (
        <div className="space-y-3">
            <div>
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Input
                            value={searchText}
                            onChange={(e) => {
                                setSearchText(e.target.value);
                                setSelectedToAdd(new Set());
                            }}
                            placeholder="Nome do perfil..."
                        />
                        {searchText.trim() && (
                            <div className="absolute z-50 top-full left-0 right-0 mt-1 border rounded-lg bg-popover shadow-lg max-h-52 overflow-y-auto">
                                {searchResults.length === 0 ? (
                                    <p className="text-sm text-muted-foreground p-3">
                                        Nenhum perfil encontrado.
                                    </p>
                                ) : (
                                    <div className="py-1">
                                        {searchResults.map((profile) => {
                                            const profileId = String(profile.id);
                                            return (
                                                <div
                                                    key={profileId}
                                                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50"
                                                >
                                                    <Checkbox
                                                        checked={selectedToAdd.has(profileId)}
                                                        onCheckedChange={() => toggleToAdd(profileId)}
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium truncate">
                                                            {profile.name}
                                                        </p>
                                                        {profile.description && (
                                                            <p className="text-xs text-muted-foreground truncate">
                                                                {profile.description}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-1 shrink-0">
                                                        {profile.is_galpon_profile && (
                                                            <Badge variant="outline" className="text-xs">
                                                                Galpão
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <Button
                        type="button"
                        onClick={handleVincular}
                        disabled={selectedToAdd.size === 0 || addUsers.isPending}
                        className="shrink-0"
                    >
                        Vincular
                    </Button>
                </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
                <div className="flex items-center px-4 py-2 bg-muted/50 border-b">
                    <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Perfil
                    </span>
                    <span className="w-20 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Remover
                    </span>
                </div>
                <div className="divide-y">
                    {linkedProfiles.map((profile) => {
                        const profileId = String(profile.id);
                        return (
                            <div
                                key={profileId}
                                className="flex items-center px-4 py-2.5 hover:bg-muted/20"
                            >
                                <div className="flex-1 min-w-0 flex items-center gap-2 pr-2">
                                    <span className="text-sm font-medium truncate">
                                        {profile.name}
                                    </span>
                                    {profile.is_galpon_profile && (
                                        <Badge variant="outline" className="text-xs shrink-0">
                                            Galpão
                                        </Badge>
                                    )}
                                </div>
                                <div className="w-20 flex justify-center">
                                    <Checkbox
                                        checked={false}
                                        onCheckedChange={() => handleRemove(profileId)}
                                        disabled={removeUsers.isPending}
                                        aria-label={`Remover ${profile.name}`}
                                    />
                                </div>
                            </div>
                        );
                    })}
                    {[...Array(emptyRowCount)].map((_, i) => (
                        <div key={`empty-${i}`} className="flex items-center px-4 py-2.5 h-[42px]">
                            <span className="flex-1" />
                            <div className="w-20 flex justify-center">
                                <Checkbox disabled className="opacity-30" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
