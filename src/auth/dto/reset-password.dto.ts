import { IsString, MinLength } from 'class-validator';

export class RequestPasswordResetDto {
  @IsString()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(6)
  password: string;
}

