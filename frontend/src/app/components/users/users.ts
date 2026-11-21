import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AccessService } from '../../services/access.service';

interface CatalogExtra { key: string; label: string }
interface CatalogModule { key: string; label: string; actions: string[]; extras: CatalogExtra[] }

const ACTION_LABELS: Record<string, string> = {
  view: 'View',
  create: 'Create',
  update: 'Update',
  delete: 'Delete'
};

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './users.html',
  styleUrl: './users.css'
})
export class UsersComponent implements OnInit {
  private readonly apiService = inject(ApiService);
  readonly access = inject(AccessService);

  get canCreate(): boolean { return this.access.can('users', 'create'); }
  get canUpdate(): boolean { return this.access.can('users', 'update'); }
  get canDelete(): boolean { return this.access.can('users', 'delete'); }

  modules = signal<CatalogModule[]>([]);
  presets = signal<{ key: string; label: string; grants: any }[]>([]);
  users = signal<any[]>([]);
  auditLog = signal<any[]>([]);

  isLoading = signal<boolean>(true);
  isSaving = signal<boolean>(false);
  activeTab = signal<'list' | 'add' | 'log'>('list');
  error = signal<string | null>(null);
  notice = signal<string | null>(null);

  // Access editor
  editingUser = signal<any | null>(null);
  matrix = signal<Record<string, Record<string, boolean>>>({});

  // New account form
  newUser = { username: '', password: '', role: 'user', preset: '' };

  // Password reset
  resetTarget = signal<any | null>(null);
  resetValue = signal<string>('');

  ngOnInit(): void {
    this.loadCatalog();
    this.loadUsers();
  }

  private loadCatalog(): void {
    this.apiService.getAccessCatalog().subscribe({
      next: (res) => {
        this.modules.set(res.modules || []);
        this.presets.set(res.presets || []);
      },
      error: () => this.error.set('Could not load the access catalogue.')
    });
  }

  private loadUsers(): void {
    this.isLoading.set(true);
    this.apiService.getUsers().subscribe({
      next: (res) => {
        this.users.set(res);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.error.set(err.error?.error || 'Could not load users.');
      }
    });
  }

  loadAudit(): void {
    this.error.set(null);
    this.apiService.getAccessAudit().subscribe({
      next: (res) => this.auditLog.set(res),
      error: () => this.error.set('Could not load the activity log.')
    });
  }

  selectTab(tab: 'list' | 'add' | 'log'): void {
    this.activeTab.set(tab);
    this.error.set(null);
    this.notice.set(null);
    if (tab === 'log') this.loadAudit();
  }

  private blankMatrix(): Record<string, Record<string, boolean>> {
    const out: Record<string, Record<string, boolean>> = {};
    for (const module of this.modules()) out[module.key] = {};
    return out;
  }

  /** Flattens stored grants into the checkbox shape the editor binds to. */
  private toMatrix(grants: any): Record<string, Record<string, boolean>> {
    const out = this.blankMatrix();
    for (const module of this.modules()) {
      const source = grants?.[module.key] || {};
      out[module.key] = {};
      for (const action of module.actions) out[module.key][action] = !!source[action];
      for (const extra of module.extras) out[module.key][extra.key] = !!source[extra.key];
    }
    return out;
  }

  value(moduleKey: string, action: string): boolean {
    return !!this.matrix()[moduleKey]?.[action];
  }

  /**
   * Keeps the editor honest with the server rules: 'view' is implied by any other right,
   * and switching 'view' off removes the whole module.
   */
  toggle(moduleKey: string, action: string, checked: boolean): void {
    const current = this.matrix();
    const row = { ...(current[moduleKey] || {}) };
    const module = this.modules().find((m) => m.key === moduleKey);
    if (!module) return;

    if (action === 'view' && !checked) {
      for (const key of Object.keys(row)) row[key] = false;
    } else {
      row[action] = checked;
      if (checked) row['view'] = true;
    }

    this.matrix.set({ ...current, [moduleKey]: row });
  }

  rowTouched(moduleKey: string): boolean {
    const row = this.matrix()[moduleKey] || {};
    return Object.values(row).some(Boolean);
  }

  openAccess(user: any): void {
    this.error.set(null);
    this.notice.set(null);
    this.editingUser.set(user);
    this.matrix.set(this.toMatrix(user.grants));
  }

  closeAccess(): void {
    this.editingUser.set(null);
    this.matrix.set(this.blankMatrix());
  }

  applyPreset(presetKey: string): void {
    const preset = this.presets().find((p) => p.key === presetKey);
    if (!preset) return;
    this.matrix.set(this.toMatrix(preset.grants));
  }

  saveAccess(): void {
    const user = this.editingUser();
    if (!user) return;
    this.isSaving.set(true);
    this.error.set(null);
    this.apiService.updateUserPermissions(user.id, this.matrix()).subscribe({
      next: (updated) => {
        this.isSaving.set(false);
        this.closeAccess();
        this.users.update((list) => list.map((u) => (u.id === updated.id ? updated : u)));
        this.refreshOwnAccess(user.id);
        this.notice.set(`Access saved for ${updated.username}.`);
      },
      error: (err) => {
        this.isSaving.set(false);
        this.error.set(err.error?.error || 'Could not save access.');
      }
    });
  }

  onCreateAccount(): void {
    this.error.set(null);
    this.notice.set(null);
    if (!this.newUser.username.trim() || !this.newUser.password) {
      this.error.set('Username and password are both required.');
      return;
    }
    this.isSaving.set(true);
    const payload: any = {
      username: this.newUser.username.trim(),
      password: this.newUser.password,
      role: this.newUser.role
    };
    if (payload.role === 'user') payload.grants = this.matrix();

    this.apiService.createUser(payload).subscribe({
      next: (user) => {
        this.isSaving.set(false);
        this.users.update((list) => [...list, user]);
        this.newUser = { username: '', password: '', role: 'user', preset: '' };
        this.matrix.set(this.blankMatrix());
        this.notice.set(`${user.username} created.`);
      },
      error: (err) => {
        this.isSaving.set(false);
        this.error.set(err.error?.error || 'Could not create the account.');
      }
    });
  }

  changeRole(user: any, role: string): void {
    const label = role === 'admin' ? 'master account (every right)' : 'normal account with assigned rights';
    if (!confirm(`Make ${user.username} a ${label}?`)) return;
    this.error.set(null);
    this.apiService.updateUserRole(user.id, role).subscribe({
      next: (updated) => {
        this.users.update((list) => list.map((u) => (u.id === updated.id ? updated : u)));
        this.notice.set(`${updated.username} is now ${updated.role === 'admin' ? 'a master account' : 'a normal account'}.`);
      },
      error: (err) => this.error.set(err.error?.error || 'Could not change the role.')
    });
  }

  openPasswordReset(user: any): void {
    this.resetTarget.set(user);
    this.resetValue.set('');
  }

  closePasswordReset(): void {
    this.resetTarget.set(null);
    this.resetValue.set('');
  }

  submitPasswordReset(): void {
    const user = this.resetTarget();
    if (!user) return;
    if (this.resetValue().length < 8) {
      this.error.set('Password must be at least 8 characters.');
      return;
    }
    this.isSaving.set(true);
    this.apiService.resetUserPassword(user.id, this.resetValue()).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.closePasswordReset();
        this.notice.set(`Password updated for ${user.username}.`);
      },
      error: (err) => {
        this.isSaving.set(false);
        this.error.set(err.error?.error || 'Could not reset the password.');
      }
    });
  }

  remove(user: any): void {
    if (!confirm(`Delete ${user.username}? Accounts with business records cannot be deleted.`)) return;
    this.error.set(null);
    this.apiService.deleteUser(user.id).subscribe({
      next: () => this.users.update((list) => list.filter((u) => u.id !== user.id)),
      error: (err) => this.error.set(err.error?.error || 'Could not delete the user.')
    });
  }

  rightsSummary(user: any): string {
    if (user.isAdmin) return 'Everything (master account)';
    const parts: string[] = [];
    for (const module of this.modules()) {
      const row = user.grants?.[module.key] || {};
      const actions = [...module.actions, ...module.extras.map((e) => e.key)].filter((a) => row[a]);
      if (actions.length) {
        parts.push(`${module.label}: ${actions.map((a) => ACTION_LABELS[a] || a).join('/')}`);
      }
    }
    return parts.length ? parts.join(' · ') : 'No rights assigned';
  }

  formatStamp(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  changesText(entry: any): string {
    if (!entry.changes) return '';
    try {
      return JSON.stringify(entry.changes);
    } catch {
      return String(entry.changes);
    }
  }

  /** Editing your own row is blocked server-side, but a master account editing another
   * master is not — refresh so the sidebar and buttons match the saved state. */
  private refreshOwnAccess(changedUserId: number): void {
    const me = this.access.access();
    if (me && me.userId === changedUserId) this.apiService.getMe().subscribe({ error: () => undefined });
  }
}
