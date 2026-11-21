import { Injectable, signal } from '@angular/core';

export type ModuleGrants = Record<string, boolean>;
export type GrantMap = Record<string, ModuleGrants>;

export interface AccessState {
  userId: number;
  username: string;
  role: string;
  isAdmin: boolean;
  grants: GrantMap;
}

const STORAGE_KEY = 'access';

/**
 * Mirrors the backend grant matrix (backend/services/access.js) in the browser so the
 * UI can hide what the current user cannot do. It is presentation only: every route is
 * still enforced by requireAccess on the server, and this state is refreshed from
 * /api/auth/me so a revoked right disappears without logging out.
 */
@Injectable({ providedIn: 'root' })
export class AccessService {
  private cached = this.readStorage();

  readonly access = signal<AccessState | null>(this.cached);
  readonly isAdmin = signal<boolean>(!!this.cached?.isAdmin);
  readonly grants = signal<GrantMap>(this.cached?.grants || {});

  private readStorage(): AccessState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as AccessState) : null;
    } catch {
      return null;
    }
  }

  apply(access: AccessState | null | undefined): void {
    if (!access) {
      this.clear();
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(access));
    this.access.set(access);
    this.isAdmin.set(!!access.isAdmin);
    this.grants.set(access.grants || {});
  }

  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.access.set(null);
    this.isAdmin.set(false);
    this.grants.set({});
  }

  can(module: string, action = 'view'): boolean {
    if (this.isAdmin()) return true;
    return !!this.grants()?.[module]?.[action];
  }

  /** True when the user may change anything inside a module — hides whole toolbars. */
  canWrite(module: string, actions: string[] = ['create', 'update', 'delete']): boolean {
    if (this.isAdmin()) return true;
    return actions.some((action) => this.can(module, action));
  }

  /** Label used by the "no access" placeholder screens. */
  describe(module: string, action = 'view'): string {
    return `${action} on ${module}`;
  }
}
