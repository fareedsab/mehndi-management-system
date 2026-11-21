import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AccessService } from './access.service';

/**
 * Reads `data.module` / `data.action` from a route and refuses the page when the current
 * account lacks that right. Mirrors requireAccess on the server: the guard is only there
 * so users never land on a screen that would answer every call with 403.
 */
export const permissionGuard: CanActivateFn = (route) => {
  const access = inject(AccessService);
  const router = inject(Router);

  const module = route.data?.['module'] as string | undefined;
  const action = (route.data?.['action'] as string) || 'view';
  if (!module || access.can(module, action)) return true;

  // /account is open to every signed-in user, so it is a safe place to explain the block.
  const fallback = access.can('dashboard', 'view') ? ['/dashboard'] : ['/account'];
  return router.createUrlTree(fallback);
};
