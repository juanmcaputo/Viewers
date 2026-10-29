import React from 'react';

// Iconos de la barra que OHIF no trae: lupa con "+" (acercar) y lupa con "-" (alejar).
// Mismo tamanio y trazo que los iconos de herramientas de OHIF (28x28, currentColor), asi
// toman el color de la barra (normal, activo, deshabilitado).

const Lupa = ({ signo, ...props }: { signo: 'mas' | 'menos' } & React.SVGProps<SVGSVGElement>) => (
  <svg
    width="28px"
    height="28px"
    viewBox="0 0 28 28"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle
        cx="12"
        cy="12"
        r="7"
      />
      <line
        x1="17"
        y1="17"
        x2="23"
        y2="23"
      />
      <line
        x1="8.5"
        y1="12"
        x2="15.5"
        y2="12"
      />
      {signo === 'mas' && (
        <line
          x1="12"
          y1="8.5"
          x2="12"
          y2="15.5"
        />
      )}
    </g>
  </svg>
);

export const IconoAcercar = (props: React.SVGProps<SVGSVGElement>) => (
  <Lupa
    signo="mas"
    {...props}
  />
);

export const IconoAlejar = (props: React.SVGProps<SVGSVGElement>) => (
  <Lupa
    signo="menos"
    {...props}
  />
);
