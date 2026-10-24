import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { loadEnv } from '../../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Envío de correo. Con SMTP_URL usa SMTP (en desarrollo, Mailpit del docker compose).
 * Sin SMTP_URL, en desarrollo escribe el mensaje en el log; en producción es obligatorio.
 * En pruebas guarda los mensajes en `sent` para verificarlos.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger('Mailer');
  private readonly transporter: Transporter | null;
  private readonly env = loadEnv();
  readonly sent: MailMessage[] = [];

  constructor() {
    this.transporter = this.env.SMTP_URL ? nodemailer.createTransport(this.env.SMTP_URL) : null;
  }

  async send(message: MailMessage): Promise<void> {
    if (this.env.NODE_ENV === 'test') {
      this.sent.push(message);
      return;
    }
    if (!this.transporter) {
      this.logger.warn(`SMTP no configurado. Correo para ${message.to}: ${message.subject}\n${message.text}`);
      return;
    }
    await this.transporter.sendMail({ from: this.env.MAIL_FROM, ...message });
  }
}
