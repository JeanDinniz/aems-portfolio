// Validação compartilhada de placa / chassi do vidro (espelha app/core/validators.py)

// Placa brasileira (cobre Mercosul ABC1D23 e antiga ABC1234) — 7 caracteres
export const PLATE_REGEX = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
// Chassi gravado no vidro (padrão CONTRAN: últimos 8 caracteres do chassi).
// Exatamente 8 alfanuméricos, com pelo menos 1 letra E 1 dígito.
export const CHASSI_VIDRO_REGEX = /^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{8}$/;

export const PLATE_ERROR_MESSAGE =
    'Formato inválido. Use placa (ABC1234 / ABC1D23) ou chassi do vidro (8 caracteres com letras e números).';

/** Normaliza para maiúsculas e remove tudo que não seja A-Z ou 0-9. */
export function normalizePlate(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Indica se o valor é uma placa ou chassi do vidro válido (normaliza antes). */
export function isValidPlateOrChassi(value: string): boolean {
    const v = normalizePlate(value);
    return PLATE_REGEX.test(v) || CHASSI_VIDRO_REGEX.test(v);
}
