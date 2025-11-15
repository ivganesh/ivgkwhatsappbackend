import { IsString, IsOptional } from 'class-validator';

export class ConnectWhatsAppDto {
  @IsString()
  code: string; // Code from Meta Embedded Signup

  @IsOptional()
  @IsString()
  companyId?: string; // Optional: if user already has a company
}

export class CompleteWhatsAppSetupDto {
  @IsString()
  wabaId: string;

  @IsString()
  phoneNumberId: string;

  @IsString()
  accessToken: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}

