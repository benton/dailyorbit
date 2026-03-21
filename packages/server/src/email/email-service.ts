import nodemailer from 'nodemailer';
import type { Transporter, SentMessageInfo } from 'nodemailer';

export type EmailServiceConfig = {
  transport: 'ses' | 'smtp' | 'test';
  region?: string;
  senderAddress?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
};

export type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailService = {
  sendMail: (input: SendMailInput) => Promise<SentMessageInfo>;
};

export async function createSesTransporter(
  region: string,
): Promise<Transporter> {
  const { SESv2Client } = await import('@aws-sdk/client-sesv2');
  const aws = await import('@aws-sdk/client-sesv2');
  const ses: InstanceType<typeof SESv2Client> = new SESv2Client({ region });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- nodemailer SES transport types are incomplete
  return nodemailer.createTransport({ SES: { ses, aws } } as any);
}

export function createEmailService(config: EmailServiceConfig): EmailService {
  const senderAddress: string =
    config.senderAddress ?? 'alerts@daily-orbit.example.com';

  // For SES, the transporter is created lazily on first send
  let transporterPromise: Promise<Transporter> | null = null;

  function getTransporter(): Promise<Transporter> {
    if (transporterPromise) return transporterPromise;

    if (config.transport === 'ses') {
      transporterPromise = createSesTransporter(config.region ?? 'us-east-2');
    } else if (config.transport === 'smtp') {
      transporterPromise = Promise.resolve(
        nodemailer.createTransport({
          host: config.smtpHost,
          port: config.smtpPort ?? 587,
          secure: false,
          auth: {
            user: config.smtpUser,
            pass: config.smtpPass,
          },
        }),
      );
    } else {
      // Test transport — returns message as JSON
      transporterPromise = Promise.resolve(
        nodemailer.createTransport({ jsonTransport: true }),
      );
    }

    return transporterPromise;
  }

  return {
    async sendMail(input: SendMailInput): Promise<SentMessageInfo> {
      const transporter: Transporter = await getTransporter();
      return transporter.sendMail({
        from: senderAddress,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
    },
  };
}
