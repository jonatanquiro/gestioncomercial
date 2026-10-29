<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/** Aviso de vencimiento de la suscripción (etapas d7, d3, d1, due y paused). Solo texto. */
class SubscriptionNoticeMail extends Mailable
{
    public function __construct(
        public readonly string $name,
        public readonly string $tradeName,
        public readonly string $stage,
        public readonly string $dueDate,
        public readonly string $blockDate,
        public readonly string $link,
        public readonly string $planName,
        public readonly string $monthlyPrice,
    ) {}

    public function envelope(): Envelope
    {
        $subject = match ($this->stage) {
            'd1' => "Tu suscripción de {$this->tradeName} vence mañana",
            'due' => "Venció la suscripción de {$this->tradeName}",
            'paused' => "Pausamos el acceso de {$this->tradeName}",
            default => "Tu suscripción de {$this->tradeName} vence el {$this->dueDate}",
        };

        return new Envelope(subject: $subject);
    }

    public function content(): Content
    {
        return new Content(text: 'mail.subscription-notice');
    }
}
