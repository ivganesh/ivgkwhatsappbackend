import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('MAIL_HOST'),
      port: parseInt(this.configService.get<string>('MAIL_PORT') || '587', 10),
      secure: false, // true for 465, false for other ports
      auth: {
        user: this.configService.get<string>('MAIL_USERNAME'),
        pass: this.configService.get<string>('MAIL_PASSWORD'),
      },
    });
  }

  async sendVerificationEmail(email: string, token: string) {
    const appUrl = this.configService.get<string>('app.url');
    const verificationUrl = `${appUrl}/verify-email?token=${token}`;

    const mailOptions = {
      from: this.configService.get<string>('MAIL_FROM'),
      to: email,
      subject: 'Verify your IVGK WhatsApp account',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .button { 
              background-color: #25D366; 
              color: white; 
              padding: 12px 24px; 
              text-decoration: none;
              border-radius: 4px;
              display: inline-block;
              margin: 20px 0;
            }
            .footer { margin-top: 30px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Verify Your Email</h1>
            <p>Thank you for signing up for IVGK WhatsApp Platform!</p>
            <p>Please click the button below to verify your email address:</p>
            <a href="${verificationUrl}" class="button">Verify Email</a>
            <p>Or copy this link: ${verificationUrl}</p>
            <p>This link will expire in 24 hours.</p>
            <div class="footer">
              <p>If you didn't create an account, please ignore this email.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await this.transporter.sendMail(mailOptions);
  }

  async sendPasswordResetEmail(email: string, token: string) {
    const appUrl = this.configService.get<string>('app.url');
    const resetUrl = `${appUrl}/reset-password?token=${token}`;

    const mailOptions = {
      from: this.configService.get<string>('MAIL_FROM'),
      to: email,
      subject: 'Reset your IVGK WhatsApp password',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .button { 
              background-color: #25D366; 
              color: white; 
              padding: 12px 24px; 
              text-decoration: none;
              border-radius: 4px;
              display: inline-block;
              margin: 20px 0;
            }
            .footer { margin-top: 30px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Reset Your Password</h1>
            <p>You requested to reset your password for your IVGK WhatsApp account.</p>
            <p>Click the button below to reset your password:</p>
            <a href="${resetUrl}" class="button">Reset Password</a>
            <p>Or copy this link: ${resetUrl}</p>
            <p>This link will expire in 1 hour.</p>
            <div class="footer">
              <p>If you didn't request a password reset, please ignore this email.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await this.transporter.sendMail(mailOptions);
  }

  async sendWelcomeEmail(email: string, name: string) {
    const mailOptions = {
      from: this.configService.get<string>('MAIL_FROM'),
      to: email,
      subject: 'Welcome to IVGK WhatsApp Platform',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Welcome to IVGK WhatsApp Platform!</h1>
            <p>Hi ${name},</p>
            <p>Thank you for joining IVGK WhatsApp Platform. We're excited to have you on board!</p>
            <p>Get started by connecting your WhatsApp Business account and start engaging with your customers.</p>
          </div>
        </body>
        </html>
      `,
    };

    await this.transporter.sendMail(mailOptions);
  }
}

