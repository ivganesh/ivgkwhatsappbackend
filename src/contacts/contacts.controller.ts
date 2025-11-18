import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { ImportContactsDto } from './dto/import-contacts.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('contacts')
@Controller('contacts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  create(
    @CurrentUser() user: any,
    @Body('companyId') companyId: string,
    @Body() createContactDto: CreateContactDto,
  ) {
    return this.contactsService.create(companyId, createContactDto);
  }

  @Post('import')
  @ApiOperation({ summary: 'Bulk import contacts for a company' })
  importContacts(
    @CurrentUser() user: any,
    @Body('companyId') companyId: string,
    @Body() importContactsDto: ImportContactsDto,
  ) {
    return this.contactsService.importContacts(companyId, importContactsDto.contacts);
  }

  @Get()
  findAll(
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.contactsService.findAll(
      companyId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Query('companyId') companyId: string, @Param('id') id: string) {
    return this.contactsService.findOne(companyId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
    @Param('id') id: string,
    @Body() updateData: Partial<CreateContactDto>,
  ) {
    return this.contactsService.update(companyId, id, updateData);
  }

  @Delete(':id')
  delete(@CurrentUser() user: any, @Query('companyId') companyId: string, @Param('id') id: string) {
    return this.contactsService.delete(companyId, id);
  }
}

