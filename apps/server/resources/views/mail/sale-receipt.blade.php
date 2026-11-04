@php
    $ars = fn ($v) => '$ '.number_format((float) $v, 2, ',', '.');
    $qty = fn ($q) => rtrim(rtrim(number_format((float) $q, 3, ',', '.'), '0'), ',');
    $date = \Illuminate\Support\Carbon::parse($sale['confirmedAt'])->setTimezone('America/Buenos_Aires')->format('d/m/Y H:i');
    $cuit = fn ($c) => $c && strlen($c) === 11 ? substr($c, 0, 2).'-'.substr($c, 2, 8).'-'.substr($c, 10) : $c;
@endphp
<!doctype html>
<html lang="es">
<body style="margin:0;padding:24px 12px;background:#f4f2ee;font-family:Arial,Helvetica,sans-serif;color:#1f1d17;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e5e1d8;">
    <tr><td style="padding:24px 24px 8px;text-align:center;">
        <div style="font-size:20px;font-weight:bold;">{{ $shop['tradeName'] }}</div>
        @if ($invoice)
            <div style="font-size:13px;color:#555;">{{ $invoice['issuerName'] }} · CUIT {{ $cuit($invoice['cuit']) }}</div>
            @if ($invoice['issuerAddress'])<div style="font-size:13px;color:#555;">{{ $invoice['issuerAddress'] }}</div>@endif
            <div style="font-size:13px;color:#555;">{{ $invoice['issuerTaxCondition'] }}</div>
        @else
            @if ($shop['address'])<div style="font-size:13px;color:#555;">{{ $shop['address'] }}</div>@endif
            @if ($shop['phone'])<div style="font-size:13px;color:#555;">Tel. {{ $shop['phone'] }}</div>@endif
        @endif
    </td></tr>
    <tr><td style="padding:8px 24px;">
        @if ($invoice)
            @if ($invoice['test'])<div style="border:2px solid #b45309;color:#b45309;padding:6px;text-align:center;font-weight:bold;font-size:12px;margin-bottom:8px;">PRUEBA DE HOMOLOGACIÓN · SIN VALIDEZ FISCAL</div>@endif
            <div style="font-size:16px;font-weight:bold;">{{ $invoice['title'] }} {{ $invoice['number'] }}</div>
            <div style="font-size:13px;color:#555;">Fecha {{ $invoice['date'] }} · Receptor: {{ $invoice['buyerName'] }}</div>
        @else
            <div style="font-size:16px;font-weight:bold;">Venta N° {{ str_pad((string) $sale['number'], 8, '0', STR_PAD_LEFT) }}</div>
            <div style="font-size:13px;color:#555;">{{ $date }} · {{ $sale['branchName'] }} · Atendió {{ $sale['cashierName'] }}</div>
        @endif
    </td></tr>
    <tr><td style="padding:8px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-top:1px dashed #ccc;border-bottom:1px dashed #ccc;">
            @if ($sale['giftCard'])
                <tr><td style="padding:8px 0;">Gift card</td><td style="padding:8px 0;text-align:right;">{{ $ars($sale['giftCard']['amount']) }}</td></tr>
            @endif
            @foreach ($sale['lines'] as $l)
                <tr>
                    <td style="padding:8px 0 0;">{{ $l['description'] }}</td>
                    <td style="padding:8px 0 0;text-align:right;white-space:nowrap;">{{ $ars($l['total']) }}</td>
                </tr>
                <tr><td colspan="2" style="padding:0 0 8px;font-size:12px;color:#666;">
                    {{ $qty($l['quantity']) }} × {{ $ars($l['unitPrice']) }}@if ($l['discountPercent'] !== '0.00') · −{{ str_replace('.', ',', $l['discountPercent']) }}%@endif
                    @if ($l['promotionName']) · {{ $l['promotionName'] }} −{{ $ars($l['promotionDiscount']) }}@endif
                </td></tr>
            @endforeach
        </table>
    </td></tr>
    <tr><td style="padding:8px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
            @if ($invoice && $invoice['showVat'])
                <tr><td>Neto gravado</td><td style="text-align:right;">{{ $ars($invoice['net']) }}</td></tr>
                <tr><td>IVA</td><td style="text-align:right;">{{ $ars($invoice['vat']) }}</td></tr>
            @endif
            <tr><td style="padding-top:4px;font-size:18px;font-weight:bold;">Total</td><td style="padding-top:4px;text-align:right;font-size:18px;font-weight:bold;">{{ $ars($invoice['total'] ?? $sale['total']) }}</td></tr>
            @unless ($invoice)
                @if (($sale['priceList'] ?? 'list') === 'cash')
                    <tr><td colspan="2" style="font-size:13px;color:#555;">Precios de contado</td></tr>
                @endif
                @foreach ($sale['payments'] as $p)
                    <tr><td style="font-size:13px;color:#555;">{{ $p['name'] }}</td><td style="text-align:right;font-size:13px;color:#555;">{{ $ars($p['amount']) }}</td></tr>
                @endforeach
            @endunless
            @if ($invoice && $invoice['transparency'])
                <tr><td colspan="2" style="padding-top:8px;font-size:12px;color:#555;">Régimen de Transparencia Fiscal al Consumidor Ley 27.743 · IVA contenido: {{ $ars($invoice['vat']) }}</td></tr>
            @endif
        </table>
    </td></tr>
    <tr><td style="padding:8px 24px 24px;text-align:center;font-size:13px;color:#555;">
        @if ($invoice)
            <div>CAE {{ $invoice['cae'] }} · Vence {{ $invoice['caeExpiresOn'] }}</div>
            <div style="margin-top:12px;"><a href="{{ $invoice['arcaUrl'] }}" style="display:inline-block;background:#1f3b2d;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:bold;">Consultar el comprobante en ARCA</a></div>
            <div style="margin-top:8px;font-size:12px;">Comprobante autorizado electrónicamente.</div>
        @else
            <div style="font-weight:bold;">Comprobante no válido como factura</div>
        @endif
        <div style="margin-top:12px;font-size:15px;">¡Gracias por tu compra!</div>
    </td></tr>
</table>
</td></tr></table>
</body>
</html>
