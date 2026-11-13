<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/** Invitación al dueño de un comercio dado de alta desde la plataforma: elige su contraseña. Solo texto. */
class OwnerInvitationMail extends Mailable
{
    public function __construct(
        public readonly string $name,
        public readonly string $tradeName,
        public readonly string $link,
        public readonly int $days,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: "Tu comercio {$this->tradeName} ya está listo");
    }

    public function content(): Content
    {
        return new Content(text: 'mail.owner-invitation');
    }
}
