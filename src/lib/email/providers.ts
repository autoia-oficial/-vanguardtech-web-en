import nodemailer, { type Transporter } from 'nodemailer';
import type {
  EmailProvider,
  OutgoingEmail,
  SendResult,
  ProviderAvailability,
} from './types';

/**
 * SMTP transport via nodemailer.
 *
 * A send is reported ok only when the SMTP server accepted the message and
 * returned a message id. Anything else is a failure, classified as retryable
 * or not so the queue can back off rather than hammer a permanent rejection.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly key = 'smtp';
  readonly label = 'SMTP';

  private transporter: Transporter | null = null;

  availability(): ProviderAvailability {
    const missing = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'].filter(
      (n) => !process.env[n]?.trim(),
    );
    if (missing.length) {
      return {
        available: false,
        reason: 'NOT_CONFIGURED: SMTP credentials are not set.',
        missing,
      };
    }
    return { available: true };
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    const port = Number(process.env.SMTP_PORT);
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // 465 is implicit TLS; 587 upgrades via STARTTLS.
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
    return this.transporter;
  }

  async send(email: OutgoingEmail): Promise<SendResult> {
    const availability = this.availability();
    if (!availability.available) {
      return { ok: false, error: availability.reason, retryable: false };
    }

    try {
      const info = await this.getTransporter().sendMail({
        from: email.from,
        to: email.to,
        subject: email.subject,
        text: email.body,
      });

      // No message id means we cannot prove the server took it.
      if (!info?.messageId) {
        return {
          ok: false,
          error: 'SMTP server returned no message id; treating as not sent.',
          retryable: true,
        };
      }

      const rejected = (info.rejected ?? []) as string[];
      if (rejected.length > 0) {
        return {
          ok: false,
          error: `Recipient rejected by SMTP server: ${rejected.join(', ')}`,
          retryable: false,
        };
      }

      return { ok: true, provider_message_id: info.messageId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { responseCode?: number })?.responseCode;
      // 5xx is a permanent refusal; 4xx and transport errors are worth retrying.
      const retryable = typeof code === 'number' ? code < 500 : true;
      return { ok: false, error: message, retryable };
    }
  }
}

/**
 * Stand-in used when no transport is configured. It never sends and never
 * claims to: every call fails with NOT_CONFIGURED so the queue leaves the
 * email pending instead of recording a delivery that did not happen.
 */
export class UnconfiguredEmailProvider implements EmailProvider {
  readonly key = 'unconfigured';
  readonly label = 'No transport configured';

  availability(): ProviderAvailability {
    return {
      available: false,
      reason:
        'NOT_CONFIGURED: no email transport is set up. Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD.',
      missing: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'],
    };
  }

  async send(): Promise<SendResult> {
    return {
      ok: false,
      error: 'No email transport configured; refusing to report a send.',
      retryable: false,
    };
  }
}

let override: EmailProvider | null = null;

/** Injects a provider for tests. Pass null to restore normal selection. */
export function setEmailProvider(provider: EmailProvider | null): void {
  override = provider;
}

export function getEmailProvider(): EmailProvider {
  if (override) return override;
  const smtp = new SmtpEmailProvider();
  return smtp.availability().available ? smtp : new UnconfiguredEmailProvider();
}
