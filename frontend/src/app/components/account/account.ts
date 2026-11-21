import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AccessService } from '../../services/access.service';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './account.html',
  styleUrl: './account.css'
})
export class AccountComponent {
  private readonly apiService = inject(ApiService);
  readonly access = inject(AccessService);

  currentPassword = '';
  newPassword = '';
  confirmPassword = '';

  message = signal<string | null>(null);
  error = signal<string | null>(null);
  isSaving = signal<boolean>(false);

  get moduleSummaries(): string[] {
    if (this.access.isAdmin()) return ['Everything — this is a master account'];
    const grants = this.access.grants();
    const lines: string[] = [];
    for (const key of Object.keys(grants)) {
      const actions = Object.keys(grants[key]).filter((action) => grants[key][action]);
      if (actions.length) lines.push(`${key}: ${actions.join(', ')}`);
    }
    return lines.length ? lines : ['No modules yet — ask an administrator for rights'];
  }

  onSubmit(): void {
    this.error.set(null);
    this.message.set(null);

    if (!this.currentPassword || !this.newPassword) {
      this.error.set('Enter your current password and a new one.');
      return;
    }
    if (this.newPassword.length < 8) {
      this.error.set('New password must be at least 8 characters.');
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.error.set('The two new passwords do not match.');
      return;
    }

    this.isSaving.set(true);
    this.apiService.changeOwnPassword({
      currentPassword: this.currentPassword,
      newPassword: this.newPassword
    }).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.currentPassword = this.newPassword = this.confirmPassword = '';
        this.message.set('Password updated. Use it the next time you log in.');
      },
      error: (err) => {
        this.isSaving.set(false);
        this.error.set(err.error?.error || 'Could not change the password.');
      }
    });
  }
}
