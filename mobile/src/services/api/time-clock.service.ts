import { apiClient } from './client';
import type {
    EnrollFacePayload,
    EnrollFaceResponse,
    MyMirrorPeriod,
    PunchPayload,
    TimeClockMe,
    TimeClockMirrorFilters,
    TimeClockMirrorResponse,
    TimeClockMyMirrorResponse,
    TimeClockRecord,
} from '@/types/time-clock.types';

/**
 * timeClockService — Ponto Eletrônico.
 *
 * Endpoints do backend:
 *  - `POST /time-clock/punch` → registra a batida (horário é do servidor).
 *    201 em sucesso; 409 com `detail` claro para violação de sequência
 *    (primeira do dia = entrada; não repete tipo; saída exige entrada);
 *    422 quando o usuário não tem vínculo com funcionário.
 *  - `GET /time-clock/me` → estado do funcionário logado + batidas.
 *
 * O service não trata erros: propaga o AxiosError para a tela, que usa
 * `getApiErrorMessage` (exibe o `detail` do 409/422 diretamente).
 */
export const timeClockService = {
    /** Registra uma batida de ponto. Retorna o registro criado (201). */
    async punch(data: PunchPayload): Promise<TimeClockRecord> {
        const { data: record } = await apiClient.post<TimeClockRecord>('/time-clock/punch', data);
        return record;
    },

    /** Estado do ponto do funcionário logado (vínculo, horário, batidas). */
    async me(): Promise<TimeClockMe> {
        const { data } = await apiClient.get<TimeClockMe>('/time-clock/me');
        // `face_enrolled` é campo novo do backend; default false para tolerar
        // respostas de um backend anterior (defensivo).
        return { ...data, face_enrolled: data.face_enrolled ?? false };
    },

    /**
     * Cadastra o rosto de referência (enrollment). O embedding é gerado NO
     * APARELHO — o backend NÃO recebe a foto, só o "código do rosto".
     * 201 em sucesso; 422 sem vínculo de funcionário ou sem consentimento.
     */
    async enrollFace(payload: EnrollFacePayload): Promise<EnrollFaceResponse> {
        const { data } = await apiClient.post<EnrollFaceResponse>(
            '/time-clock/enroll-face',
            payload
        );
        return data;
    },

    /**
     * Espelho de Ponto (admin): lista paginada de batidas por loja/data/funcionário.
     * (O export em PDF é feito via `downloadAndSharePdf` no path `/time-clock/export/pdf`.)
     */
    async list(params: TimeClockMirrorFilters): Promise<TimeClockMirrorResponse> {
        const { data } = await apiClient.get<TimeClockMirrorResponse>('/time-clock', { params });
        return data;
    },

    /**
     * Autoatendimento "Meu Espelho" (`GET /time-clock/me/mirror`): o próprio
     * funcionário consulta suas batidas das últimas 24h ou do mês corrente.
     * (O export em PDF sai por `downloadAndSharePdf` no path `/time-clock/me/export/pdf`.)
     */
    async myMirror(period: MyMirrorPeriod): Promise<TimeClockMyMirrorResponse> {
        const { data } = await apiClient.get<TimeClockMyMirrorResponse>('/time-clock/me/mirror', {
            params: { period },
        });
        return data;
    },
};
