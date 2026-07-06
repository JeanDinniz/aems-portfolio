import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function UnauthorizedPage() {
    const navigate = useNavigate();

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
            <Card className="max-w-md w-full">
                <CardHeader className="text-center">
                    <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                        <ShieldAlert className="h-8 w-8 text-red-600" />
                    </div>
                    <CardTitle className="text-2xl">Acesso Negado</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-center text-gray-600">
                        Você não tem permissão para acessar esta página.
                    </p>
                    <p className="text-center text-sm text-gray-500">
                        Se você acredita que deveria ter acesso, entre em contato com o
                        administrador do sistema.
                    </p>
                    <Button variant="outline" onClick={() => navigate(-1)} className="w-full">
                        Voltar
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
