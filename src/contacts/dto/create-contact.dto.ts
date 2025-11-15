import { IsString, IsOptional, IsEmail, IsArray } from 'class-validator';

export class CreateContactDto {
  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

