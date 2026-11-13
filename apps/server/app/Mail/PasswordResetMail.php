<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/** Enlace para elegir una contraseña nueva (vence en 30 minutos). Solo texto. */
class PasswordResetMail extends Mailable
{
    public function __construct(
        public readonly string $name,
        public readonly string $link,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Restablecer tu contraseña');
    }

    public function content(): Content
    {
        return new Content(text: 'mail.password-reset');
    }
}
