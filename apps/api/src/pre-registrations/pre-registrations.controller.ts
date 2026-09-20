import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { EntitlementFeature } from '@prisma/client';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { UserRole } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireEntitlement } from '../common/decorators/require-entitlement.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireCustomerId, requireTenantId } from '../common/tenant/tenant.util';
import { CreatePreRegistrationDto } from './dto/create-pre-registration.dto';
import { UpdatePreRegistrationDto } from './dto/update-pre-registration.dto';
import { PreRegistrationsService } from './pre-registrations.service';

/**
 * Customer Self-Service Pre-Registration, Stage 1: the authenticated
 * customer-portal surface, same isolation posture as CustomerPortalController
 * (`@Roles(CUSTOMER)` at the class level covers every route here, gated
 * behind the same CUSTOMER_PORTAL entitlement — a pre-registration is part
 * of that same customer-facing experience, not a separately licensed
 * feature). Every handler derives tenantId/customerId from the verified
 * JWT via requireTenantId()/requireCustomerId() — never a route param or
 * request body.
 */
@Controller('portal/pre-registrations')
@Roles(UserRole.CUSTOMER)
@RequireEntitlement(EntitlementFeature.CUSTOMER_PORTAL)
export class PreRegistrationsController {
  constructor(private readonly preRegistrationsService: PreRegistrationsService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePreRegistrationDto) {
    return this.preRegistrationsService.create(requireTenantId(user.tenantId), requireCustomerId(user.customerId), dto);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.preRegistrationsService.listForCustomer(requireTenantId(user.tenantId), requireCustomerId(user.customerId));
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.preRegistrationsService.findOneForCustomer(
      requireTenantId(user.tenantId),
      requireCustomerId(user.customerId),
      id,
    );
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdatePreRegistrationDto) {
    return this.preRegistrationsService.update(
      requireTenantId(user.tenantId),
      requireCustomerId(user.customerId),
      id,
      dto,
    );
  }

  @Post(':id/submit')
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.preRegistrationsService.submit(requireTenantId(user.tenantId), requireCustomerId(user.customerId), id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.preRegistrationsService.cancel(requireTenantId(user.tenantId), requireCustomerId(user.customerId), id);
  }
}
