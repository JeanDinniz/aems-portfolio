/**
 * Crash reporting (HARD-02) — testes de src/lib/sentry.ts.
 *
 * A integração é CONDICIONAL ao DSN, resolvido de `env.SENTRY_DSN` no load do
 * módulo. Para cobrir os dois cenários (com/sem DSN), cada bloco reimporta o
 * módulo dentro de `jest.isolateModules()` com o env mockado adequado.
 *
 * O nativo `@sentry/react-native` é mockado no jest.setup.js.
 */
import type * as SentrySDK from '@sentry/react-native';

type SentryLib = typeof import('@/lib/sentry');

const sentryMock = jest.requireMock('@sentry/react-native') as jest.Mocked<typeof SentrySDK>;

/** Carrega src/lib/sentry com um SENTRY_DSN forçado (isolado por chamada). */
function loadSentry(dsn: string): SentryLib {
    let lib!: SentryLib;
    jest.isolateModules(() => {
        jest.doMock('@/lib/env', () => ({
            env: {
                API_URL: 'http://localhost:8000/api/v1',
                WS_URL: 'ws://localhost:8000',
                ENV: 'staging',
                SENTRY_DSN: dsn,
            },
        }));
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        lib = require('@/lib/sentry');
    });
    return lib;
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('initSentry — sem DSN (desabilitado)', () => {
    it('NÃO chama Sentry.init', () => {
        const { initSentry } = loadSentry('');
        initSentry();
        expect(sentryMock.init).not.toHaveBeenCalled();
    });

    it('isSentryEnabled é false', () => {
        const { isSentryEnabled } = loadSentry('');
        expect(isSentryEnabled()).toBe(false);
    });

    it('helpers são no-op (não chamam o Sentry)', () => {
        const { addBreadcrumb, captureException, setUserId } = loadSentry('');
        addBreadcrumb('auth', 'login attempt', { foo: 'bar' });
        captureException(new Error('x'), { ctx: 1 });
        setUserId(42);
        expect(sentryMock.addBreadcrumb).not.toHaveBeenCalled();
        expect(sentryMock.captureException).not.toHaveBeenCalled();
        expect(sentryMock.setUser).not.toHaveBeenCalled();
    });

    it('wrapApp devolve o App intacto (sem Sentry.wrap)', () => {
        const { wrapApp } = loadSentry('');
        const App = () => null;
        expect(wrapApp(App)).toBe(App);
        expect(sentryMock.wrap).not.toHaveBeenCalled();
    });
});

describe('initSentry — com DSN (habilitado)', () => {
    const DSN = 'https://public@o0.ingest.sentry.io/123';

    it('chama Sentry.init com environment correto e scrubbers', () => {
        const { initSentry } = loadSentry(DSN);
        initSentry();
        expect(sentryMock.init).toHaveBeenCalledTimes(1);
        const opts = sentryMock.init.mock.calls[0][0];
        expect(opts?.dsn).toBe(DSN);
        expect(opts?.environment).toBe('staging');
        expect(typeof opts?.beforeSend).toBe('function');
        expect(typeof opts?.beforeBreadcrumb).toBe('function');
    });

    it('isSentryEnabled é true', () => {
        const { isSentryEnabled } = loadSentry(DSN);
        expect(isSentryEnabled()).toBe(true);
    });

    it('addBreadcrumb repassa ao Sentry (com data redigido)', () => {
        const { addBreadcrumb } = loadSentry(DSN);
        addBreadcrumb('upload', 'success', { id: 'up_1', access_token: 'zzz' });
        expect(sentryMock.addBreadcrumb).toHaveBeenCalledTimes(1);
        const arg = sentryMock.addBreadcrumb.mock.calls[0][0];
        expect(arg.category).toBe('upload');
        expect(arg.message).toBe('success');
        expect(arg.data).toEqual({ id: 'up_1', access_token: '[Filtered]' });
    });

    it('captureException repassa ao Sentry (com extra redigido)', () => {
        const { captureException } = loadSentry(DSN);
        const err = new Error('boom');
        captureException(err, { password: 'hunter2', attempts: 3 });
        expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
        const [passedErr, ctx] = sentryMock.captureException.mock.calls[0];
        expect(passedErr).toBe(err);
        expect((ctx as { extra: Record<string, unknown> }).extra).toEqual({
            password: '[Filtered]',
            attempts: 3,
        });
    });

    it('setUserId seta SOMENTE o id (string) e limpa com null', () => {
        const { setUserId } = loadSentry(DSN);
        setUserId(7);
        expect(sentryMock.setUser).toHaveBeenCalledWith({ id: '7' });
        setUserId(null);
        expect(sentryMock.setUser).toHaveBeenCalledWith(null);
    });

    it('wrapApp envolve o App com Sentry.wrap', () => {
        const { wrapApp } = loadSentry(DSN);
        const App = () => null;
        wrapApp(App);
        expect(sentryMock.wrap).toHaveBeenCalledWith(App);
    });
});

describe('scrub — remove/redige dados sensíveis', () => {
    // O scrub não depende de DSN; qualquer load serve.
    const load = () => loadSentry('https://x@o.ingest.sentry.io/1');

    it('scrubData redige Authorization, tokens e password (case-insensitive)', () => {
        const { scrubData } = load();
        const input = {
            Authorization: 'Bearer abc',
            access_token: 'aaa',
            refresh_token: 'rrr',
            password: 'p',
            PASSWORD: 'p2',
            nested: { some_token: 't', keep: 'ok' },
            list: [{ Cookie: 'c', ok: 1 }],
            plain: 'visible',
        };
        expect(scrubData(input)).toEqual({
            Authorization: '[Filtered]',
            access_token: '[Filtered]',
            refresh_token: '[Filtered]',
            password: '[Filtered]',
            PASSWORD: '[Filtered]',
            nested: { some_token: '[Filtered]', keep: 'ok' },
            list: [{ Cookie: '[Filtered]', ok: 1 }],
            plain: 'visible',
        });
    });

    it('scrubData tolera ciclos e valores primitivos', () => {
        const { scrubData } = load();
        expect(scrubData(5)).toBe(5);
        expect(scrubData('x')).toBe('x');
        expect(scrubData(null)).toBeNull();
        const cyclic: Record<string, unknown> = { a: 1 };
        cyclic.self = cyclic;
        expect(() => scrubData(cyclic)).not.toThrow();
    });

    it('scrubEvent limpa headers de request e PII do usuário', () => {
        const { scrubEvent } = load();
        const event = {
            request: {
                url: 'https://api/x',
                headers: { Authorization: 'Bearer secret', 'X-Foo': 'bar' },
            },
            extra: { access_token: 'aaa', count: 2 },
            user: { id: 99, email: 'jean@x.com', username: 'jean', ip_address: '1.2.3.4' },
        } as unknown as SentrySDK.ErrorEvent;

        const out = scrubEvent(event) as unknown as {
            request: { headers: Record<string, string> };
            extra: Record<string, unknown>;
            user: Record<string, unknown>;
        };

        expect(out.request.headers.Authorization).toBe('[Filtered]');
        expect(out.request.headers['X-Foo']).toBe('bar');
        expect(out.extra).toEqual({ access_token: '[Filtered]', count: 2 });
        // Só o id sobrevive — email/username/ip removidos.
        expect(out.user).toEqual({ id: 99 });
    });

    it('scrubBreadcrumb redige o data', () => {
        const { scrubBreadcrumb } = load();
        const out = scrubBreadcrumb({
            category: 'api',
            message: 'GET /x',
            data: { authorization: 'Bearer y', status: 200 },
        });
        expect(out.data).toEqual({ authorization: '[Filtered]', status: 200 });
    });
});
