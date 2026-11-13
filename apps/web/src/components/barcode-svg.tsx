import { barcodeModules } from '@/lib/barcode';

/** Código de barras en SVG: EAN-13 si el texto lo es, si no Code 128 B. Sin texto debajo. */
export function BarcodeSvg({ code, className }: { code: string; className?: string }) {
  const encoded = barcodeModules(code);
  if (!encoded) return <div className={className} />;
  const quiet = 10;
  const bars: Array<[number, number]> = [];
  for (let i = 0; i < encoded.modules.length; i++) {
    if (encoded.modules[i] !== '1') continue;
    const start = i;
    while (encoded.modules[i + 1] === '1') i++;
    bars.push([start, i - start + 1]);
  }
  return (
    <svg className={className} viewBox={`0 0 ${encoded.modules.length + quiet * 2} 40`} preserveAspectRatio="none" role="img" aria-label={`Código ${code}`} shapeRendering="crispEdges">
      {bars.map(([x, w]) => (
        <rect key={x} x={x + quiet} y={0} width={w} height={40} fill="#000" />
      ))}
    </svg>
  );
}
