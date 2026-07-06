import { consultantsService } from '@/services/api/consultants.service';

/**
 * Admin — Fatia 5a: consultantsService.exportPath.
 * O download em si é feito por downloadAndShareExcel (testado à parte); aqui só
 * garantimos o path do endpoint de export.
 */
describe('consultantsService.exportPath', () => {
    it('retorna /consultants/export', () => {
        expect(consultantsService.exportPath()).toBe('/consultants/export');
    });
});
