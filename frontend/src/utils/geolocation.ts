export class GeolocationError extends Error {
    constructor(message: string, public readonly code: number) {
        super(message)
        this.name = 'GeolocationError'
    }
}

export function getCurrentPosition(options?: PositionOptions): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new GeolocationError('Geolocalização não é suportada neste dispositivo.', 0))
            return
        }

        navigator.geolocation.getCurrentPosition(
            (position) => resolve(position),
            (error) => {
                let message: string
                switch (error.code) {
                    case 1: // PERMISSION_DENIED
                        message =
                            'Permissão de localização negada. Acesse as configurações do navegador e permita o acesso à localização para esta página.'
                        break
                    case 2: // POSITION_UNAVAILABLE
                        message =
                            'Localização indisponível. Verifique se o GPS está ativado no dispositivo.'
                        break
                    case 3: // TIMEOUT
                        message =
                            'Tempo limite para obter localização esgotado. Verifique sua conexão e tente novamente.'
                        break
                    default:
                        message = 'Erro desconhecido ao obter localização.'
                }
                reject(new GeolocationError(message, error.code))
            },
            options
        )
    })
}
