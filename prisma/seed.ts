import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Check if super admin already exists
  const existingAdmin = await prisma.user.findFirst({
    where: { isSuperAdmin: true },
  });

  if (existingAdmin) {
    console.log('✅ Super admin already exists');
    return;
  }

  // Create super admin user
  const hashedPassword = await bcrypt.hash('ivgkadmin123', 10);

  const superAdmin = await prisma.user.create({
    data: {
      email: 'admin@ivgk.com',
      password: hashedPassword,
      name: 'Super Admin',
      isSuperAdmin: true,
      isActive: true,
      emailVerifiedAt: new Date(),
      timezone: 'UTC',
      locale: 'en',
    },
  });

  console.log('✅ Super admin created:');
  console.log('   Email: admin@ivgk.com');
  console.log('   Password: ivgkadmin123');
  console.log('   ⚠️  Please change the password after first login!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });




