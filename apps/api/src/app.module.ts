import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { CustomersModule } from './customers/customers.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { WarehouseModule } from './warehouse/warehouse.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    CustomersModule,
    ShipmentsModule,
    WarehouseModule,
    HealthModule,
  ],
  providers: [
    // Every route requires authentication by default; opt out with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Enforces @Roles(...) metadata once a user is authenticated.
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
