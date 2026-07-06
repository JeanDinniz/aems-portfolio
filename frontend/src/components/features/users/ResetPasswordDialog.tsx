import { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUsers } from '@/hooks/useUsers';
import type { User } from '@/types/user.types';

interface ResetPasswordDialogProps {
    user: User;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function ResetPasswordDialog({ user, open, onOpenChange }: ResetPasswordDialogProps) {
    const { resetPassword, isResettingPassword } = useUsers();
    const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const handleConfirm = async () => {
        const data = await resetPassword(user.id);
        setTemporaryPassword(data.temporary_password);
    };

    const handleCopy = () => {
        if (!temporaryPassword) return;
        navigator.clipboard.writeText(temporaryPassword);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleClose = () => {
        setTemporaryPassword(null);
        setCopied(false);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={temporaryPassword ? () => {} : onOpenChange}>
            <DialogContent
                hideCloseButton={!!temporaryPassword}
                onPointerDownOutside={temporaryPassword ? (e) => e.preventDefault() : undefined}
                onEscapeKeyDown={temporaryPassword ? (e) => e.preventDefault() : undefined}
            >
                {temporaryPassword ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>Senha Temporária Gerada</DialogTitle>
                            <DialogDescription>
                                Copie a senha abaixo e compartilhe com <strong>{user.full_name}</strong>.
                                Ela <strong>não poderá ser recuperada</strong> após fechar este diálogo.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="flex items-center gap-2 rounded-md border bg-muted px-4 py-3 font-mono text-base">
                            <span className="flex-1 select-all">{temporaryPassword}</span>
                            <Button variant="outline" size="sm" onClick={handleCopy}>
                                {copied ? 'Copiado!' : 'Copiar'}
                            </Button>
                        </div>

                        <DialogFooter>
                            <Button onClick={handleClose}>Fechar</Button>
                        </DialogFooter>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle>Resetar Senha</DialogTitle>
                            <DialogDescription>
                                Deseja gerar uma nova senha temporária para <strong>{user.full_name}</strong>?
                                <br />
                                A nova senha será exibida na tela e <strong>não poderá ser recuperada depois</strong> se não for salva.
                            </DialogDescription>
                        </DialogHeader>

                        <DialogFooter>
                            <Button variant="outline" disabled={isResettingPassword} onClick={handleClose}>
                                Cancelar
                            </Button>
                            <Button
                                variant="destructive"
                                disabled={isResettingPassword}
                                onClick={handleConfirm}
                            >
                                {isResettingPassword ? 'Gerando...' : 'Confirmar Reset'}
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
