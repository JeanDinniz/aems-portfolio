/**
 * Crash reporting (HARD-02) — integração Sentry CONDICIONAL ao DSN.
 *
 * Decisão do PO: o projeto Sentry ainda não existe. Esta integração é COMPLETA,
 * porém só liga quando `env.SENTRY_DSN` estiver presente. Sem DSN:
 *   - `initSentry()` retorna sem chamar `Sentry.init` (no-op total, zero overhead);
 *   - os helpers `addBreadcrumb`/`captureException` são no-ops;
 *   - `wrapApp(App)` devolve o próprio App (sem o HOC do Sentry).
 * Ou seja, o app roda IDÊNTICO a hoje. Quando o PO criar o projeto Sentry e
 * injetar o DSN (EAS secret `SENTRY_DSN` em preview/production — ver eas.json),
 * o crash reporting passa a funcionar SEM mudar código.
 *
 * Privacidade (doc 02 §7 / doc 07 §7): NUNCA enviar PII nem credenciais. O
 * `scrub()` remove/redige o header `Authorization`, tokens (`*token*`,
 * `access_token`, `refresh_token`) e `password` de eventos e breadcrumbs. Não
 * setamos `Sentry.setUser` com e-mail/nome; ver `setUserId` abaixo.
 */
import * as Sentry from '@sentry/react-native';

import { env } from '@/lib/env';

/** DSN resolvido do env (vazio = Sentry desabilitado). */
const DSN = env.SENTRY_DSN;

/** `true` quando há DSN configurado — Sentry ativo. */
export const isSentryEnabled = (): boolean => !!DSN;

// ─── Scrub de dados sensíveis ────────────────────────────────────────────────

const REDACTED = '[Filtered]';

/** Chaves cujo VALOR deve ser redigido (case-insensitive, match por substring). */
const SENSITIVE_KEY_PATTERNS = [
    'authorization',
    'token', // cobre access_token, refresh_token, expo push token, csrf token…
    'password',
    'secret',
    'cookie',
    'set-cookie',
];

function isSensitiveKey(key: string): boolean {
    const k = key.toLowerCase();
    return SENSITIVE_KEY_PATTERNS.some((p) => k.includes(p));
}

/**
 * Redige recursivamente valores de chaves sensíveis em objetos/arrays.
 * Retorna uma nova estrutura (não muta a original). Preserva a forma para não
 * atrapalhar o debug — só troca o VALOR sensível por `[Filtered]`.
 */
export function scrubData<T>(value: T, seen = new WeakSet<object>()): T {
    if (value == null || typeof value !== 'object') return value;

    // Evita ciclos.
    if (seen.has(value as object)) return value;
    seen.add(value as object);

    if (Array.isArray(value)) {
        return value.map((v) => scrubData(v, seen)) as unknown as T;
    }

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        if (isSensitiveKey(key)) {
            out[key] = REDACTED;
        } else {
            out[key] = scrubData(val, seen);
        }
    }
    return out as unknown as T;
}

/**
 * Scrub de um evento Sentry antes do envio (`beforeSend`). Limpa:
 *  - headers de request (Authorization, Cookie…);
 *  - dados de request/`extra`/`contexts` com tokens/senhas;
 *  - PII do usuário (mantém no máximo o `id`; remove email/username/ip).
 * Exportada para teste isolado.
 */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
    const e = event as unknown as Record<string, unknown>;

    if (e.request && typeof e.request === 'object') {
        e.request = scrubData(e.request);
    }
    if (e.extra && typeof e.extra === 'object') {
        e.extra = scrubData(e.extra);
    }
    if (e.contexts && typeof e.contexts === 'object') {
        e.contexts = scrubData(e.contexts);
    }
    if (e.breadcrumbs && Array.isArray(e.breadcrumbs)) {
        e.breadcrumbs = (e.breadcrumbs as unknown[]).map((b) => scrubData(b));
    }
    // PII do usuário: nunca enviamos email/username/ip. No máximo o id.
    if (e.user && typeof e.user === 'object') {
        const u = e.user as Record<string, unknown>;
        e.user = u.id != null ? { id: u.id } : undefined;
    }

    return event;
}

/**
 * Scrub de um breadcrumb antes de registrar (`beforeBreadcrumb`). Limpa o
 * `data` (query/headers/body de request HTTP e afins). Exportada para teste.
 */
export function scrubBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
    if (breadcrumb.data && typeof breadcrumb.data === 'object') {
        return { ...breadcrumb, data: scrubData(breadcrumb.data) };
    }
    return breadcrumb;
}

// ─── Inicialização ───────────────────────────────────────────────────────────

/**
 * Inicializa o Sentry SE houver DSN. Chamar o mais cedo possível (topo de
 * `App.tsx`). Sem DSN, é um no-op silencioso.
 */
export function initSentry(): void {
    if (!DSN) {
        if (__DEV__) {
            console.log('[sentry] desabilitado (sem SENTRY_DSN).');
        }
        return;
    }

    Sentry.init({
        dsn: DSN,
        environment: env.ENV,
        // Não enviar eventos em dev/Expo Go: ruído + sem símbolos úteis. (No
        // Sentry RN v7 não há mais `enableInExpoDevelopment`; `enabled` cobre.)
        enabled: !__DEV__,
        debug: false,
        // Amostragem baixa de tracing (o foco é crash/erro, não performance).
        tracesSampleRate: 0.2,
        // Não anexar o número de telefone/nome/ip do device automaticamente.
        sendDefaultPii: false,
        beforeSend: (event) => scrubEvent(event),
        beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    });
}

/**
 * Envolve o componente App com o HOC do Sentry (error boundary + touch/nav
 * instrumentation) QUANDO há DSN; caso contrário devolve o App intacto. Assim o
 * `App.tsx`/`index.ts` não precisa de branch.
 */
export function wrapApp<C>(App: C): C {
    return DSN ? (Sentry.wrap(App as never) as unknown as C) : App;
}

// ─── Helpers finos (no-op sem DSN) ───────────────────────────────────────────

/**
 * Registra um breadcrumb (rastro de navegação para diagnosticar crashes). No-op
 * sem DSN. O `data` é redigido pelo scrub antes de ir ao Sentry. Use categorias
 * curtas (`auth`, `service_order`, `upload`) e mensagens SEM PII.
 */
export function addBreadcrumb(
    category: string,
    message: string,
    data?: Record<string, unknown>
): void {
    if (!DSN) return;
    Sentry.addBreadcrumb({
        category,
        message,
        level: 'info',
        data: data ? scrubData(data) : undefined,
    });
}

/**
 * Captura uma exceção manualmente (para erros que seriam engolidos e são úteis
 * no diagnóstico). No-op sem DSN. O `context` extra é redigido pelo scrub.
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
    if (!DSN) return;
    Sentry.captureException(error, context ? { extra: scrubData(context) } : undefined);
}

/**
 * Correlaciona eventos ao usuário usando SOMENTE o `id` (nunca email/nome).
 * No-op sem DSN. Chamar com `null` no logout para limpar.
 *
 * Decisão: usamos apenas `{ id }` — o mínimo necessário para agrupar crashes de
 * um mesmo usuário sem vazar PII. E-mail/nome ficam de fora (o `scrubEvent`
 * também reforça isso caso algo escape).
 */
export function setUserId(id: number | string | null): void {
    if (!DSN) return;
    Sentry.setUser(id == null ? null : { id: String(id) });
}
