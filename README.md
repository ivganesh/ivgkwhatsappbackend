# IVGK WhatsApp Business Platform - Backend

NestJS backend application for the IVGK WhatsApp Business Platform - a complete SaaS system for managing WhatsApp Business communications.

## Features

- ✅ Multi-tenant SaaS architecture
- ✅ JWT Authentication & Authorization
- ✅ User & Company Management
- ✅ WhatsApp Cloud API Integration
- ✅ Contact Management
- ✅ Message Sending & Receiving
- ✅ Webhook Handling
- ✅ Email Service (Gmail SMTP)
- ✅ Rate Limiting
- ✅ Database with Prisma ORM

## Tech Stack

- **Framework**: NestJS 11.x
- **Language**: TypeScript 5.x
- **Database**: PostgreSQL 15+
- **ORM**: Prisma 6.x
- **Authentication**: JWT (Passport)
- **Email**: Nodemailer (Gmail SMTP)
- **Rate Limiting**: @nestjs/throttler
- **Validation**: class-validator, class-transformer

## Prerequisites

- Node.js 20.x LTS or higher
- PostgreSQL 15+ database
- Redis (optional, for queues)
- Gmail account with App Password (for email service)
- Meta Developer Account (for WhatsApp API)

## Installation

1. **Clone and navigate to backend directory:**
   ```bash
   cd backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and fill in your configuration values.

4. **Set up database:**
   ```bash
   # Generate Prisma Client
   npx prisma generate
   
   # Run migrations
   npx prisma migrate dev --name init
   ```

5. **Start the development server:**
   ```bash
   npm run start:dev
   ```

The API will be available at `http://localhost:3000/api`

## Environment Variables

See `.env.example` for all required environment variables. Key variables:

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret key for JWT tokens
- `META_APP_ID` - Meta/Facebook App ID
- `META_APP_SECRET` - Meta/Facebook App Secret
- `MAIL_USERNAME` - Gmail address
- `MAIL_PASSWORD` - Gmail App Password

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/verify-email` - Verify email address
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password
- `POST /api/auth/refresh` - Refresh access token
- `GET /api/auth/me` - Get current user profile

### Companies
- `POST /api/companies` - Create company
- `GET /api/companies` - List user's companies
- `GET /api/companies/:id` - Get company details
- `PATCH /api/companies/:id` - Update company
- `POST /api/companies/:id/users` - Add user to company
- `DELETE /api/companies/:id/users/:userId` - Remove user from company

### Contacts
- `POST /api/contacts?companyId=xxx` - Create contact
- `GET /api/contacts?companyId=xxx` - List contacts
- `GET /api/contacts/:id?companyId=xxx` - Get contact
- `PATCH /api/contacts/:id?companyId=xxx` - Update contact
- `DELETE /api/contacts/:id?companyId=xxx` - Delete contact

### Messages
- `GET /api/messages?companyId=xxx` - List messages
- `GET /api/messages/:id?companyId=xxx` - Get message

### WhatsApp
- `POST /api/whatsapp/webhook` - Webhook endpoint for Meta
- `POST /api/whatsapp/send/text` - Send text message
- `POST /api/whatsapp/send/template` - Send template message
- `POST /api/whatsapp/send/media` - Send media message

## Database Schema

The database schema is defined in `prisma/schema.prisma`. Key models:

- **User** - Platform users
- **Company** - Multi-tenant companies
- **CompanyUser** - User-company relationships with roles
- **Contact** - Customer contacts
- **Message** - WhatsApp messages
- **Conversation** - Chat conversations
- **Campaign** - Bulk messaging campaigns
- **Template** - WhatsApp message templates
- **Chatbot** - Automation bots
- **Subscription** - Billing subscriptions
- **Credit** - Credit balance system

## Project Structure

```
backend/
├── src/
│   ├── auth/              # Authentication module
│   ├── companies/         # Company management
│   ├── contacts/          # Contact management
│   ├── messages/          # Message management
│   ├── whatsapp/          # WhatsApp integration
│   ├── email/             # Email service
│   ├── common/            # Shared utilities
│   │   ├── guards/        # Auth guards
│   │   ├── decorators/    # Custom decorators
│   │   └── prisma/        # Prisma service
│   └── config/            # Configuration files
├── prisma/
│   └── schema.prisma      # Database schema
└── .env                   # Environment variables
```

## Development

```bash
# Development mode with hot reload
npm run start:dev

# Production build
npm run build
npm run start:prod

# Run tests
npm run test

# Run e2e tests
npm run test:e2e
```

## Database Migrations

```bash
# Create a new migration
npx prisma migrate dev --name migration_name

# Apply migrations in production
npx prisma migrate deploy

# View database in Prisma Studio
npx prisma studio
```

## Next Steps

The following modules are planned but not yet implemented:

- [ ] Campaign Management Module
- [ ] Template Management Module
- [ ] Chatbot & Automation Module
- [ ] Analytics & Reporting Module
- [ ] Subscription & Billing Module (Razorpay)
- [ ] API Keys Module
- [ ] WebSocket for real-time updates

## License

Private - IVGK WhatsApp Platform
