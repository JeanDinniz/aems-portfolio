import { HardHat } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EpiCatalogTab } from '@/components/features/epi/EpiCatalogTab';
import { CargoMapTab } from '@/components/features/epi/CargoMapTab';
import { PendenciasTab } from '@/components/features/epi/PendenciasTab';
import { ToolReceiptsTab } from '@/components/features/epi/ToolReceiptsTab';

export function EpiPage() {
    return (
        <div className="space-y-6 p-4 md:p-6">
            <div className="flex items-center gap-3">
                <HardHat className="h-7 w-7 text-amber-600" />
                <div>
                    <h1 className="text-2xl font-semibold">Controle de EPIs</h1>
                    <p className="text-sm text-muted-foreground">
                        Ficha de entrega, mapeamento por cargo e pendências
                    </p>
                </div>
            </div>

            <Tabs defaultValue="recebimentos" className="w-full">
                <TabsList className="flex-wrap">
                    <TabsTrigger value="recebimentos">Recebimentos</TabsTrigger>
                    <TabsTrigger value="pendencias">Pendências</TabsTrigger>
                    <TabsTrigger value="catalogo">Catálogo</TabsTrigger>
                    <TabsTrigger value="cargos">Mapeamento por Cargo</TabsTrigger>
                </TabsList>

                <TabsContent value="recebimentos"><ToolReceiptsTab /></TabsContent>
                <TabsContent value="pendencias"><PendenciasTab /></TabsContent>
                <TabsContent value="catalogo"><EpiCatalogTab /></TabsContent>
                <TabsContent value="cargos"><CargoMapTab /></TabsContent>
            </Tabs>
        </div>
    );
}
