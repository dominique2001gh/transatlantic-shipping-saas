import { INestApplication } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ANY_AUTHENTICATED_ROLE_KEY } from '../src/common/decorators/any-authenticated-role.decorator';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';

/**
 * RolesGuard fails OPEN when a route has no @Roles() metadata — "Routes
 * with no @Roles() metadata are allowed for any authenticated user" (see
 * RolesGuard's own doc comment). That was a low-stakes default while no
 * low-privilege role existed in practice; Stage 2C makes CUSTOMER a real,
 * actively-issued JWT role for the first time, so a future staff route
 * added without @Roles(...)/@Public() would silently become reachable by
 * a customer token — and symmetrically, a portal route added without
 * @Roles(CUSTOMER) would silently become reachable by any staff token.
 *
 * This turns that silent risk into a build-time guarantee: every actual
 * HTTP route handler registered anywhere in the real, fully-wired
 * AppModule must declare @Roles(...), @Public(), or (for the rare route
 * that's genuinely meant to be open to every authenticated role — e.g.
 * "return my own profile") @AnyAuthenticatedRole(). It inspects the live
 * Nest metadata RolesGuard/JwtAuthGuard themselves read at runtime (via
 * DiscoveryService/Reflector), not a text/regex scan of source files, so
 * it can't drift from what actually governs a request.
 */
describe('RolesGuard contract: every route handler is explicitly @Roles(...) or @Public() (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('has no route reachable by any authenticated role, or the public, by omission', () => {
    const discoveryService = app.get(DiscoveryService);
    const metadataScanner = app.get(MetadataScanner);
    const reflector = app.get(Reflector);

    const violations: string[] = [];

    for (const wrapper of discoveryService.getControllers()) {
      const instance = wrapper.instance as object | null;
      if (!instance) continue;

      const prototype = Object.getPrototypeOf(instance) as object;
      const controllerName = instance.constructor.name;
      const methodNames = metadataScanner.getAllMethodNames(prototype);

      for (const methodName of methodNames) {
        const handler = (prototype as Record<string, (...args: unknown[]) => unknown>)[methodName];

        // Only actual HTTP route handlers carry PATH_METADATA (set by
        // @Get/@Post/@Patch/etc.) — skip any other method a controller
        // class happens to declare.
        const isRouteHandler = Reflect.getMetadata(PATH_METADATA, handler) !== undefined;
        if (!isRouteHandler) continue;

        const roles = reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [handler, instance.constructor]);
        const isPublic = reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
          handler,
          instance.constructor,
        ]);
        const isAnyAuthenticatedRole = reflector.getAllAndOverride<boolean | undefined>(ANY_AUTHENTICATED_ROLE_KEY, [
          handler,
          instance.constructor,
        ]);

        if (!roles?.length && !isPublic && !isAnyAuthenticatedRole) {
          violations.push(`${controllerName}.${methodName}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('sanity check: the scan actually found routes to check (not silently empty)', () => {
    const discoveryService = app.get(DiscoveryService);
    expect(discoveryService.getControllers().length).toBeGreaterThan(5);
  });
});
