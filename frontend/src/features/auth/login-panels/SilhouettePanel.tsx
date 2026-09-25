import type { CSSProperties } from 'react';
import './login-panels.css';
import { PanelCopyright } from './shared';

/** Corpo do SUV (perfil lateral, frente para a direita, tailgate vertical). */
const CAR_BODY = [
    'M 116 144',
    'C 108 143, 104 138, 104 130',
    'L 104 114',
    'C 102 92, 105 62, 110 46',
    'C 111 39, 116 34, 124 33',
    'C 180 28, 250 26, 314 30',
    'C 326 31, 334 34, 341 39',
    'C 358 50, 376 64, 388 75',
    'C 412 79, 438 82, 458 86',
    'C 476 89, 490 95, 496 104',
    'C 502 114, 504 126, 503 135',
    'C 502 141, 498 144, 490 144',
    'L 486 144',
    'A 38 38 0 0 0 410 144',
    'L 210 144',
    'A 38 38 0 0 0 134 144',
    'L 128 144',
    'C 123 144, 119 144, 116 144',
    'Z',
].join(' ');

/** Área envidraçada (quarter window → portas → para-brisa). */
const CAR_WINDOW = [
    'M 130 84',
    'C 128 70, 130 56, 133 46',
    'C 185 40, 252 38, 310 42',
    'C 328 52, 346 64, 358 74',
    'C 285 78, 205 81, 130 84',
    'Z',
].join(' ');

/** Montantes B e C (SUV 4 portas). */
const PILLARS = 'M 262 39 L 258 80 M 186 41 L 182 82';
/** Rack de teto: barra + dois pés. */
const ROOF_RACK = 'M 140 24 C 200 20, 260 19, 306 22 M 156 22 L 156 30 M 288 20 L 288 28';
const BELT_LINE = 'M 138 112 C 230 104, 320 102, 424 108';
const HANDLE_REAR = 'M 218 94 l 20 -1';
const HANDLE_FRONT = 'M 300 92 l 20 -1';
const HEADLIGHT = 'M 458 90 C 470 92, 482 97, 489 106';
const TAILLIGHT = 'M 112 52 C 108 60, 106 70, 106 80';
const MIRROR = 'M 352 74 C 359 65, 372 64, 375 72 C 369 77, 358 78, 352 74 Z';

const drawTiming = (duration: string, delay = '0s') =>
    ({ '--lp-draw-dur': duration, '--lp-draw-delay': delay } as CSSProperties);

/**
 * Modelo Silhueta — um SUV em traço âmbar desenhado ao entrar na tela,
 * com um reflexo de película percorrendo a carroceria em loop.
 */
export function SilhouettePanel() {
    return (
        <div
            className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden p-12"
            style={{ backgroundColor: '#131313' }}
        >
            {/* Glow de estúdio atrás do carro */}
            <div
                aria-hidden
                className="absolute inset-0"
                style={{
                    background:
                        'radial-gradient(ellipse at 50% 62%, rgba(245, 168, 0, 0.09) 0%, transparent 55%)',
                }}
            />

            <div className="relative z-10 flex w-full max-w-xl flex-col items-center">
                <img
                    src="/brand/logo-white.png"
                    alt="AEMS"
                    className="lp-fade-up mb-6 w-48 object-contain drop-shadow-2xl"
                />

                <svg
                    viewBox="0 0 560 210"
                    fill="none"
                    className="w-full max-w-[580px]"
                    role="img"
                    aria-label="Silhueta de um SUV em traço"
                >
                    <defs>
                        <linearGradient id="lp-film-grad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0" stopColor="#F5A800" stopOpacity="0" />
                            <stop offset="0.45" stopColor="#F5A800" stopOpacity="0.25" />
                            <stop offset="0.55" stopColor="#FFFFFF" stopOpacity="0.18" />
                            <stop offset="1" stopColor="#F5A800" stopOpacity="0" />
                        </linearGradient>
                        <radialGradient id="lp-ground-shadow" cx="0.5" cy="0.5" r="0.5">
                            <stop offset="0" stopColor="#000000" stopOpacity="0.55" />
                            <stop offset="1" stopColor="#000000" stopOpacity="0" />
                        </radialGradient>
                        <linearGradient id="lp-ground-line" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0" stopColor="#F5A800" stopOpacity="0" />
                            <stop offset="0.5" stopColor="#F5A800" stopOpacity="0.4" />
                            <stop offset="1" stopColor="#F5A800" stopOpacity="0" />
                        </linearGradient>
                        <clipPath id="lp-car-body-clip">
                            <path d={CAR_BODY} />
                        </clipPath>
                    </defs>

                    {/* Chão do estúdio */}
                    <ellipse cx="300" cy="187" rx="230" ry="9" fill="url(#lp-ground-shadow)" />
                    <rect x="20" y="183.5" width="520" height="1.5" fill="url(#lp-ground-line)" />

                    {/* Reflexo de película varrendo a carroceria */}
                    <g clipPath="url(#lp-car-body-clip)">
                        <rect
                            className="lp-film-sweep"
                            x="-160"
                            y="30"
                            width="150"
                            height="140"
                            fill="url(#lp-film-grad)"
                        />
                    </g>

                    {/* Traço do carro */}
                    <g
                        stroke="#F5A800"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ filter: 'drop-shadow(0 0 6px rgba(245, 168, 0, 0.35))' }}
                    >
                        <path className="lp-draw" pathLength={100} d={CAR_BODY} style={drawTiming('1.8s')} />
                        <path
                            className="lp-draw"
                            pathLength={100}
                            d={CAR_WINDOW}
                            strokeWidth="1.5"
                            strokeOpacity="0.55"
                            style={drawTiming('1.2s', '0.6s')}
                        />
                        <path
                            className="lp-draw"
                            pathLength={100}
                            d={PILLARS}
                            strokeWidth="1.5"
                            strokeOpacity="0.55"
                            style={drawTiming('0.5s', '0.9s')}
                        />
                        <path
                            className="lp-draw"
                            pathLength={100}
                            d={ROOF_RACK}
                            strokeWidth="2"
                            strokeOpacity="0.7"
                            style={drawTiming('0.5s', '1.1s')}
                        />
                        <path
                            className="lp-draw"
                            pathLength={100}
                            d={BELT_LINE}
                            strokeWidth="1.5"
                            strokeOpacity="0.35"
                            style={drawTiming('0.9s', '1s')}
                        />
                        <path
                            className="lp-draw"
                            pathLength={100}
                            d={MIRROR}
                            strokeWidth="1.5"
                            strokeOpacity="0.6"
                            style={drawTiming('0.4s', '1.2s')}
                        />
                        <path
                            className="lp-draw"
                            pathLength={100}
                            d={HANDLE_REAR}
                            strokeWidth="2"
                            strokeOpacity="0.7"
                            style={drawTiming('0.3s', '1.3s')}
                        />
                        <path
                            className="lp-draw"
                            pathLength={100}
                            d={HANDLE_FRONT}
                            strokeWidth="2"
                            strokeOpacity="0.7"
                            style={drawTiming('0.3s', '1.35s')}
                        />
                        <path
                            className="lp-draw"
                            pathLength={100}
                            d={HEADLIGHT}
                            strokeWidth="2"
                            strokeOpacity="0.7"
                            style={drawTiming('0.3s', '1.35s')}
                        />
                        <path
                            className="lp-draw"
                            pathLength={100}
                            d={TAILLIGHT}
                            strokeWidth="2"
                            strokeOpacity="0.7"
                            style={drawTiming('0.3s', '1.4s')}
                        />

                        {/* Rodas */}
                        <circle className="lp-draw" pathLength={100} cx="172" cy="154" r="30" style={drawTiming('1s', '1.1s')} />
                        <circle
                            className="lp-draw"
                            pathLength={100}
                            cx="172"
                            cy="154"
                            r="13"
                            strokeWidth="1.5"
                            strokeOpacity="0.6"
                            style={drawTiming('0.7s', '1.35s')}
                        />
                        <circle className="lp-draw" pathLength={100} cx="448" cy="154" r="30" style={drawTiming('1s', '1.1s')} />
                        <circle
                            className="lp-draw"
                            pathLength={100}
                            cx="448"
                            cy="154"
                            r="13"
                            strokeWidth="1.5"
                            strokeOpacity="0.6"
                            style={drawTiming('0.7s', '1.35s')}
                        />
                    </g>
                </svg>

                <p
                    className="lp-fade-up mt-6 text-base text-zinc-300"
                    style={{ '--lp-delay': '0.9s' } as CSSProperties}
                >
                    Proteção e brilho, do capô ao porta-malas
                    <span style={{ color: '#F5A800' }}>.</span>
                </p>
                <p
                    className="lp-fade-up font-display mt-3 text-xs uppercase tracking-[0.3em] text-zinc-500"
                    style={{ '--lp-delay': '1.1s' } as CSSProperties}
                >
                    Película <span style={{ color: '#F5A800' }}>·</span> PPF{' '}
                    <span style={{ color: '#F5A800' }}>·</span> Funilaria{' '}
                    <span style={{ color: '#F5A800' }}>·</span> Estética
                </p>
            </div>

            <PanelCopyright />
        </div>
    );
}
