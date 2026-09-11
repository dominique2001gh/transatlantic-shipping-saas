import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StaffInvitationsModule } from '../staff-invitations/staff-invitations.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Stage 3I: imports AuthModule (which exports AuthService) so
 * UsersController can delegate PATCH /users/me/password to
 * AuthService.changePassword — password/credential logic stays owned by
 * AuthService, the existing single home for authentication concerns,
 * rather than being duplicated here. No circular dependency: AuthModule
 * never imports UsersModule.
 *
 * Staff Invitations stage: also imports StaffInvitationsModule (a leaf
 * module, no circular-dependency risk either) so UsersController can
 * expose the permanent invite/list/resend staff-management endpoints.
 */
@Module({
  imports: [AuthModule, StaffInvitationsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
