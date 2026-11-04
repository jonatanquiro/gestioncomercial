<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Address;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * Comprobante de una venta para el cliente: el ticket (no válido como factura) o la factura
 * electrónica autorizada, con el enlace de consulta de ARCA. Sale con el nombre del comercio y,
 * si tiene email, las respuestas le llegan a él.
 */
class SaleReceiptMail extends Mailable
{
    /**
     * @param  array{tradeName: string, address: ?string, phone: ?string, email: ?string}  $shop
     * @param  array<string, mixed>  $sale  Forma de SaleDto.
     * @param  ?array<string, mixed>  $invoice  Factura autorizada, ya preparada para mostrar.
     */
    public function __construct(
        public readonly array $shop,
        public readonly array $sale,
        public readonly ?array $invoice = null,
    ) {}

    public function envelope(): Envelope
    {
        $subject = $this->invoice
            ? "{$this->invoice['title']} {$this->invoice['number']} de {$this->shop['tradeName']}"
            : "Tu compra en {$this->shop['tradeName']} (venta N° {$this->sale['number']})";

        return new Envelope(
            from: new Address((string) config('mail.from.address'), $this->shop['tradeName']),
            replyTo: $this->shop['email'] ? [new Address($this->shop['email'], $this->shop['tradeName'])] : [],
            subject: $subject,
        );
    }

    public function content(): Content
    {
        return new Content(view: 'mail.sale-receipt');
    }
}
