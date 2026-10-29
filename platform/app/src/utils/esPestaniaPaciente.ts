/**
 * MiniPACS: true si esta pestania abrio el modo del paciente (/paciente).
 *
 * La marca la pone el modo @minipacs/mode-paciente al entrar (modes/minipacs-paciente/src/index.tsx,
 * MARCA_PESTANIA_PACIENTE; la clave tiene que ser la misma). La usan las paginas de error
 * (NotFoundStudy y NotFound) para no mostrarle al paciente links a la lista de estudios: en la puerta
 * del pase la config tiene showStudyList: true porque el medico usa la lista.
 */
const MARCA_PESTANIA_PACIENTE = 'minipacs.pestaniaPaciente';

export function esPestaniaPaciente(): boolean {
  try {
    return window.sessionStorage.getItem(MARCA_PESTANIA_PACIENTE) === '1';
  } catch (e) {
    // Sin sessionStorage: se comporta como OHIF (decide solo por showStudyList).
    return false;
  }
}
