import { IsString, IsEnum, IsOptional, IsObject, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TemplateCategory } from '@prisma/client';

export class TemplateComponentDto {
  @IsString()
  type: string;

  @IsOptional()
  @IsString()
  format?: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsArray()
  variables?: string[];

  @IsOptional()
  @IsArray()
  buttons?: any[];

  @IsOptional()
  @IsObject()
  example?: any;
}

export class CreateTemplateDto {
  @IsString()
  name: string;

  @IsEnum(TemplateCategory)
  category: TemplateCategory;

  @IsString()
  language: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateComponentDto)
  components: TemplateComponentDto[];

  @IsOptional()
  @IsObject()
  variables?: Record<string, any>;
}




