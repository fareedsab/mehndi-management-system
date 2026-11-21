import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { AccessService } from '../../services/access.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './layout.html',
  styleUrl: './layout.css'
})
export class LayoutComponent implements OnInit {
  readonly apiService = inject(ApiService);
  readonly access = inject(AccessService);

  ngOnInit(): void {
    // Grants come from the database on every boot so a right revoked since the last
    // visit cannot keep the menu lit up. A 401 here means the account is gone.
    this.apiService.getMe().subscribe({
      error: () => this.apiService.logout()
    });
  }

  logout(): void {
    this.apiService.logout();
  }
}
