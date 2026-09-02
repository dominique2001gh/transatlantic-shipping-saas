import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Stage 3I: imports AuthModule (which exports AuthService) so
 * UsersController can delegate PATCH /users/me/password to
 * AuthService.changePassword — password/credential logic stays owned by
 * AuthService, the existing single home for authentication concerns,
 * rather than being duplicated here. No circular dependency: AuthModule
 * never imports UsersModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
