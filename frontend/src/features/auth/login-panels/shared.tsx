/**
 * Elementos compartilhados entre os modelos do painel esquerdo do login.
 */

export function PanelCopyright() {
    return (
        <p className="absolute inset-x-0 bottom-8 z-10 text-center text-xs text-zinc-600">
            &copy; {new Date().getFullYear()} AEMS. Todos os direitos reservados.
        </p>
    );
}
