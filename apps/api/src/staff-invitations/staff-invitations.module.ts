import { Module } from '@nestjs/common';
import { NotificationProvidersModule } from '../notifications/providers/notification-providers.module';
import { StaffInvitationsService } from './staff-invitations.service';

/**
 * Staff Invitations stage: a leaf module (no dependency on Auth/Users/
 * Onboarding) so all three can import it without any circular-dependency
 * risk — OnboardingModule (wizard's Staff step), UsersModule (permanent
 * staff-management page), and AuthModule (public accept-invite routes)
 * all depend on this; this depends on none of them.
 */
@Module({
  imports: [NotificationProvidersModule],
  providers: [StaffInvitationsService],
  exports: [StaffInvitationsService],
})
export class StaffInvitationsModule {}
